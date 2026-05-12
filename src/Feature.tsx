import { useEffect, useRef, useState } from "react";
import {
  combineSalts,
  commit,
  randomSalt,
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

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const yPlayers = room.doc.getMap<Player>("players");
    const yCommits = room.doc.getMap<Commitment>("commits");
    const yReveals = room.doc.getMap<Reveal>("reveals");
    const yPhase = room.doc.getMap<{ phase: Phase }>("phase");
    const onChange = () => rerender((n) => n + 1);
    yPlayers.observe(onChange);
    yCommits.observe(onChange);
    yReveals.observe(onChange);
    yPhase.observe(onChange);
    return () => {
      yPlayers.unobserve(onChange);
      yCommits.unobserve(onChange);
      yReveals.unobserve(onChange);
      yPhase.unobserve(onChange);
    };
  }, [room]);

  useEffect(() => {
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Player>("players").set(room.peerId, { id: room.peerId, name: myName });
  }, [room, name]);

  const yPlayers = room.doc.getMap<Player>("players");
  const yCommits = room.doc.getMap<Commitment>("commits");
  const yReveals = room.doc.getMap<Reveal>("reveals");
  const yPhase = room.doc.getMap<{ phase: Phase }>("phase");
  const phase: Phase = yPhase.get("current")?.phase ?? "lobby";
  const players: Player[] = [];
  yPlayers.forEach((p) => players.push(p));
  players.sort((a, b) => a.id.localeCompare(b.id));

  // On entering commit phase, generate salt + commit
  useEffect(() => {
    if (phase !== "commit") return;
    if (yCommits.has(room.peerId)) return;
    const salt = randomSalt();
    saltRef.current = salt;
    void commit("", salt).then(({ hash }) => {
      yCommits.set(room.peerId, { hash });
    });
  }, [phase, room.peerId, yCommits]);

  // On entering reveal phase, publish salt
  useEffect(() => {
    if (phase !== "reveal") return;
    if (yReveals.has(room.peerId)) return;
    if (!saltRef.current) return;
    yReveals.set(room.peerId, { salt: saltRef.current });
  }, [phase, room.peerId, yReveals]);

  // Once everyone has revealed, derive role
  useEffect(() => {
    if (phase !== "reveal" && phase !== "play") return;
    if (players.length === 0) return;
    if (!players.every((p) => yReveals.has(p.id))) return;
    if (!players.every((p) => yCommits.has(p.id))) return;
    void (async () => {
      for (const p of players) {
        const c = yCommits.get(p.id)?.hash ?? "";
        const r = yReveals.get(p.id)?.salt ?? "";
        if (!(await verifyReveal(c, { salt: r, payload: "" }))) {
          console.error(`[spyfall] BAD COMMIT from ${p.id}`);
          return;
        }
      }
      const salts = players.map((p) => yReveals.get(p.id)!.salt);
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
  }, [phase, players.length, room.peerId]);

  const setPhase = (p: Phase) => yPhase.set("current", { phase: p });

  const restart = () => {
    room.doc.transact(() => {
      yCommits.clear();
      yReveals.clear();
      yPhase.set("current", { phase: "lobby" });
    });
    setMyRole(null);
    setRevealedLocation(null);
    saltRef.current = "";
  };

  const allCommitted = players.length >= 3 && players.every((p) => yCommits.has(p.id));
  const allRevealed = players.length >= 3 && players.every((p) => yReveals.has(p.id));

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
            committed: {Array.from(yCommits.keys()).length}/{players.length}
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
            revealed: {Array.from(yReveals.keys()).length}/{players.length}
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
