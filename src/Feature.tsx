import { useEffect, useRef, useState } from "react";
import {
  combineSalts,
  commit,
  randomSalt,
  usePerPeerValue,
  verifyReveal,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Phase = "lobby" | "commit" | "reveal" | "play";
type Player = { id: string; name: string };
type Commitment = { hash: string };
type Reveal = { salt: string };

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;

const LOCATIONS = [
  "Beach",
  "Casino",
  "Cathedral",
  "Cruise ship",
  "Hospital",
  "Library",
  "Movie studio",
  "Museum",
  "Pirate ship",
  "Polar station",
  "School",
  "Space station",
  "Submarine",
  "Theater",
  "Train",
];

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="spy-screen">
        <h1>spyfall</h1>
        <p className="spy-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [, rerender] = useState(0);
  const [myRole, setMyRole] = useState<"spy" | "civilian" | null>(null);
  const [revealedLocation, setRevealedLocation] = useState<string | null>(null);
  const saltRef = useRef<string>("");

  const playersMap = usePerPeerValue<Player>(room, "players", { id: "", name: "" });
  const commitsMap = usePerPeerValue<Commitment>(room, "commits", { hash: "" });
  const revealsMap = usePerPeerValue<Reveal>(room, "reveals", { salt: "" });

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const yPhase = room.doc.getMap<{ phase: Phase }>("phase");
    const onChange = () => rerender((n) => n + 1);
    yPhase.observe(onChange);
    return () => {
      yPhase.unobserve(onChange);
    };
  }, [room]);

  useEffect(() => {
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    playersMap.setMy({ id: room.peerId, name: myName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name]);

  const yPhase = room.doc.getMap<{ phase: Phase }>("phase");
  const phase: Phase = yPhase.get("current")?.phase ?? "lobby";
  const players: Player[] = playersMap.entries
    .map(([, p]) => p)
    .filter((p) => p && p.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  // On entering commit phase, generate salt + commit
  useEffect(() => {
    if (phase !== "commit") return;
    if (commitsMap.valueOf(room.peerId) !== undefined) return;
    const salt = randomSalt();
    saltRef.current = salt;
    void commit("", salt).then(({ hash }) => {
      commitsMap.setMy({ hash });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, room.peerId]);

  // On entering reveal phase, publish salt
  useEffect(() => {
    if (phase !== "reveal") return;
    if (revealsMap.valueOf(room.peerId) !== undefined) return;
    if (!saltRef.current) return;
    revealsMap.setMy({ salt: saltRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, room.peerId]);

  // Once everyone has revealed, derive role
  useEffect(() => {
    if (phase !== "reveal" && phase !== "play") return;
    if (players.length === 0) return;
    if (!players.every((p) => revealsMap.valueOf(p.id) !== undefined)) return;
    if (!players.every((p) => commitsMap.valueOf(p.id) !== undefined)) return;
    void (async () => {
      for (const p of players) {
        const c = commitsMap.valueOf(p.id)?.hash ?? "";
        const r = revealsMap.valueOf(p.id)?.salt ?? "";
        if (!(await verifyReveal(c, { salt: r, payload: "" }))) {
          console.error(`[spyfall] BAD COMMIT from ${p.id}`);
          return;
        }
      }
      const salts = players.map((p) => revealsMap.valueOf(p.id)!.salt);
      const seed = combineSalts(salts);
      const locIdx = Math.floor(seed * LOCATIONS.length) % LOCATIONS.length;
      const ids = [...players].map((p) => p.id).sort();
      const spySeed = combineSalts([...salts].reverse());
      const spyIdx = Math.floor(spySeed * ids.length) % ids.length;
      const spyId = ids[spyIdx]!;
      const location = LOCATIONS[locIdx]!;
      setMyRole(room.peerId === spyId ? "spy" : "civilian");
      setRevealedLocation(location);
      if (phase === "reveal") yPhase.set("current", { phase: "play" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, players.length, room.peerId]);

  const setPhase = (p: Phase) => yPhase.set("current", { phase: p });

  const restart = () => {
    room.doc.transact(() => {
      room.doc.getMap<Commitment>("commits").clear();
      room.doc.getMap<Reveal>("reveals").clear();
      yPhase.set("current", { phase: "lobby" });
    });
    setMyRole(null);
    setRevealedLocation(null);
    saltRef.current = "";
  };

  const allCommitted =
    players.length >= 3 && players.every((p) => commitsMap.valueOf(p.id) !== undefined);
  const allRevealed =
    players.length >= 3 && players.every((p) => revealsMap.valueOf(p.id) !== undefined);

  return (
    <div className={`spy-screen spy-phase-${phase}`}>
      <header className="spy-header">
        <h1>spyfall</h1>
        <input
          className="spy-name"
          placeholder="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
        />
        <p className="spy-status">
          phase: <strong>{phase}</strong> · {players.length} player{players.length === 1 ? "" : "s"}
        </p>
      </header>

      <ul className="spy-players">
        {players.map((p) => (
          <li key={p.id} className={p.id === room.peerId ? "is-me" : ""}>
            {p.name}
            {p.id === room.peerId ? " (you)" : ""}
          </li>
        ))}
      </ul>

      {phase === "lobby" && (
        <button
          type="button"
          disabled={players.length < 3}
          className="spy-deal"
          onClick={() => setPhase("commit")}
        >
          {players.length < 3 ? `need 3+ players (you have ${players.length})` : "deal roles"}
        </button>
      )}

      {phase === "commit" && (
        <div className="spy-card">
          <p>everyone is committing a secret seed…</p>
          <p className="spy-help">
            committed: {commitsMap.size}/{players.length}
          </p>
          <button type="button" disabled={!allCommitted} onClick={() => setPhase("reveal")}>
            all committed → reveal
          </button>
        </div>
      )}

      {phase === "reveal" && (
        <div className="spy-card">
          <p>revealing…</p>
          <p className="spy-help">
            revealed: {revealsMap.size}/{players.length}
            {allRevealed && myRole ? " · roles dealt" : ""}
          </p>
        </div>
      )}

      {phase === "play" && myRole && (
        <div className={`spy-card spy-role spy-role-${myRole}`}>
          {myRole === "spy" ? (
            <>
              <p className="spy-role-tag">YOU ARE</p>
              <p className="spy-role-big">🕵 THE SPY</p>
              <p className="spy-help">
                You don&apos;t know the location. Listen carefully and ask questions that won&apos;t
                give you away.
              </p>
            </>
          ) : (
            <>
              <p className="spy-role-tag">LOCATION</p>
              <p className="spy-role-big">{revealedLocation}</p>
              <p className="spy-help">
                One of you is the spy. Ask each other questions — figure out who&apos;s bluffing.
              </p>
            </>
          )}
          <button type="button" className="spy-restart" onClick={restart}>
            new round
          </button>
        </div>
      )}
    </div>
  );
}
