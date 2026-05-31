import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

/**
 * Open N peers in ONE browser context joined to the SAME room, with the
 * signaling URL pointed at an unreachable port so y-webrtc falls back to the
 * in-browser BroadcastChannel transport (no signaling server, no network).
 *
 * mesh-common's `openTwoPeers` only opens two pages; spyfall's advertised
 * core action needs 3+ players, so this mirrors the same init-script setup
 * for an arbitrary peer count.
 */
async function openNPeers(browser: Browser, url: string, n: number) {
  const context = await browser.newContext({ baseURL: url || undefined });
  const roomId = `e2e-roles-${Math.random().toString(36).slice(2, 8)}`;
  const signalingUrl = "ws://localhost:1/never-connects";
  await context.addInitScript(
    ({ prefix, room, sig }) => {
      try {
        localStorage.setItem(`${prefix}:room`, room);
        localStorage.setItem(`${prefix}:signalingUrl`, sig);
        localStorage.removeItem(`${prefix}:iceServers`);
      } catch {
        // ignore
      }
    },
    { prefix: storagePrefix, room: roomId, sig: signalingUrl },
  );
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) pages.push(await context.newPage());
  await Promise.all(pages.map((p) => p.goto(url)));
  return { pages, cleanup: async () => context.close() };
}

/**
 * Load-bearing cross-peer test for the ADVERTISED core action:
 * "one phone gets 'spy' via commit-reveal, everyone else gets the location".
 *
 * Drives the full lobby -> commit -> reveal -> play flow across THREE peers
 * and asserts, by reading each peer's OWN private screen:
 *   - exactly ONE peer is shown "THE SPY" (not zero, not two/three),
 *   - the other two peers are each shown a location,
 *   - both civilians see the SAME location (commit-reveal agreement crosses
 *     the mesh),
 *   - the spy's screen does NOT leak the location.
 */
test("commit-reveal deals exactly one spy + a shared location across the mesh", async ({
  browser,
  baseURL,
}) => {
  const { pages, cleanup } = await openNPeers(browser, baseURL ?? "", 3);
  const [a, b, c] = pages as [Page, Page, Page];
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await c.getByPlaceholder("your name").fill("carol");

    // All three peers must see 3 players before roles can be dealt.
    for (const p of pages) {
      await expect(p.locator(".spy-status")).toContainText("3 players");
    }

    // Peer A starts the deal: lobby -> commit.
    await a.getByRole("button", { name: "deal roles" }).click();

    // Wait until every peer has committed (commit-reveal step 1), then any
    // peer advances commit -> reveal.
    for (const p of pages) {
      await expect(p.locator(".spy-card")).toContainText("committed: 3/3");
    }
    await a.getByRole("button", { name: /all committed/ }).click();

    // After reveal, every peer derives its own role and lands on the play
    // screen. Read each peer's PRIVATE role card.
    const roleOf = async (p: Page): Promise<{ spy: boolean; location: string | null }> => {
      const card = p.locator(".spy-role");
      await expect(card).toBeVisible({ timeout: 10_000 });
      // The spy card carries the `spy-role-spy` modifier class; civilians get
      // `spy-role-civilian`. The big line is "🕵 THE SPY" or the location.
      const isSpy = (await card.getAttribute("class"))?.includes("spy-role-spy") ?? false;
      if (isSpy) return { spy: true, location: null };
      const loc = (await card.locator(".spy-role-big").innerText()).trim();
      return { spy: false, location: loc };
    };

    const results = await Promise.all(pages.map(roleOf));
    const spies = results.filter((r) => r.spy);
    const civilians = results.filter((r) => !r.spy);

    // Exactly one spy across the whole mesh.
    expect(spies, JSON.stringify(results)).toHaveLength(1);
    // The other two are civilians who each see a location.
    expect(civilians).toHaveLength(2);
    for (const civ of civilians) {
      expect(civ.location, "civilian should see a location").toBeTruthy();
    }
    // Civilians agree on the SAME location — the commit-reveal RNG produced an
    // identical result on independent peers across the mesh.
    expect(civilians[0]!.location).toBe(civilians[1]!.location);
    // The spy must NOT be shown the location.
    expect(spies[0]!.location).toBeNull();
  } finally {
    await cleanup();
  }
});
