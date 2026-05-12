import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("each peer's name appears in the other peer's player list", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await expect(b.locator(".spy-players").getByText("alice")).toBeVisible();
    await expect(a.locator(".spy-players").getByText("bob")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("deal button is disabled below 3 players", async ({ browser, baseURL }) => {
  const { a, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    const dealButton = a.getByRole("button", { name: /need 3\+ players/ });
    await expect(dealButton).toBeVisible();
    await expect(dealButton).toBeDisabled();
  } finally {
    await cleanup();
  }
});
