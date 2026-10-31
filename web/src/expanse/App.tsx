import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { Modal } from "../Modal";
import { Portrait } from "./art";
import { CreatureInspector } from "./Inspector";
import { VisitorWallet } from "./VisitorWallet";
import { BIOME_NAMES, MiniMap, WorldMap } from "./Map";
import { clampCamera, viewportQuery } from "./projection";
import { ExpanseClient, validateServer } from "./transport";
import type { Camera, Source, WorldFrame } from "./types";
import demoManifest from "./demoManifest.json";
import recordedData from "./recording.json";
import "./expanse.css";
import "./living.css";
import "./visitor-wallet.css";
const RECORDING = recordedData as unknown as WorldFrame;
const STORAGE = "stratoks-expanse-server-v1";
const VIEW_STORAGE = "stratoks-expanse-view-v2";
const PUBLIC_SERVER = "https://stratoks.2-29-11-211.sslip.io";
function initialSource(): Source {
  const q = new URLSearchParams(location.search);
  if (q.get("recorded") === "1") return { kind: "recording" };
  if (q.get("demo") === "1") return { kind: "demo", seed: 2 };
  try {
    if (!q.has("server") && localStorage.getItem(VIEW_STORAGE) === "recording") return {kind:"recording"};
    const url =
      q.get("server") ??
      (localStorage.getItem(VIEW_STORAGE) === "server"
        ? localStorage.getItem(STORAGE)
        : null);
    if (url) return { kind: "server", url: validateServer(url) };
  } catch {}
  return { kind: "demo", seed: 2 };
}
export default function ExpanseApp() {
  const [source, setSource] = useState<Source>(initialSource);
  const [frame, setFrame] = useState<WorldFrame | null>(null);
  const [camera, setCamera] = useState<Camera>({
    x: 24,
    y: 24,
    span: innerWidth < 600 ? 9.5 : 22,
  });
  const [aspect, setAspect] = useState(1.5);
  const [selected, setSelected] = useState<number | null>(null);
  const [following, setFollowing] = useState(false),
    [knowledge, setKnowledge] = useState(false),
    [borders, setBorders] = useState(false);
  const [paused, setPaused] = useState(false),
    [visualMotion, setVisualMotion] = useState(true),
    [reduced, setReduced] = useState(
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [side, setSide] = useState<
    "residents" | "inspector" | "records" | "places" | null
  >(null);
  const [modal, setModal] = useState<"settings" | "help" | "wallet" | null>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "stale"
  >(source.kind === "recording" ? "idle" : "connecting");
  const [pending, setPending] = useState(false),
    [retry, setRetry] = useState(0),
    [lastRead, setLastRead] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState(PUBLIC_SERVER);
  const [isolatedAuthDemo, setIsolatedAuthDemo] = useState(false);
  const [placeBiome,setPlaceBiome]=useState("all");
  const client = useRef<ExpanseClient | null>(null);
  const viewportWidth = useRef(innerWidth);
  const panelScroll = useRef<HTMLDivElement | null>(null);
  const display = frame ?? RECORDING,
    recorded = source.kind === "recording" || !frame;
  const query = useRef({ camera, aspect, bounds: display.bounds });
  query.current = { camera, aspect, bounds: display.bounds };
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)"),
      fn = () => setReduced(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  useEffect(() => {
    let closed = false;
    fetch(`${import.meta.env.BASE_URL}expanse-config.json`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (closed) return;
        setIsolatedAuthDemo(c?.isolatedAuthDemo === true);
        if (typeof c?.httpUrl === "string") {
          try {
            const url = validateServer(c.httpUrl || location.origin);
            setServerUrl(url);
            const q = new URLSearchParams(location.search);
            let preferred = false;
            try {
              preferred = ["recording","demo","server"].includes(localStorage.getItem(VIEW_STORAGE) ?? "");
            } catch {}
            if (
              (c.startMode === "live" || !c.startMode) &&
              new URL(url).origin === location.origin &&
              source.kind !== "server" &&
              !preferred &&
              q.get("demo") !== "1" &&
              q.get("recorded") !== "1" &&
              !q.has("server")
            ) {
              choose({ kind: "server", url }, false);
            } else if(c.startMode === "recording" && !preferred && !q.has("server") && !q.has("demo") && !q.has("recorded")) {
              choose({kind:"recording"}, false);
            }
          } catch {
            setError(
              "The configured server URL is invalid. Open Choose world to correct it.",
            );
          }
        }
      })
      .catch(() => {});
    return () => {
      closed = true;
    };
  }, []);
  useEffect(() => {
    if (source.kind === "recording") {
      client.current = null;
      return;
    }
    const c = new ExpanseClient(
      source.kind === "server" ? source.url : undefined,
      source.kind === "demo" ? source.seed : undefined,
    );
    client.current = c;
    return () => {
      c.close();
      if (client.current === c) client.current = null;
    };
  }, [source]);
  useEffect(() => {
    if (source.kind === "recording" || !client.current) return;
    let closed = false,
      timer: ReturnType<typeof setTimeout>,
      controller: AbortController;
    const c = client.current;
    const read = async () => {
      controller = new AbortController();
      let failed = false;
      try {
        const p = query.current,
          f = await c.read(
            {
              ...viewportQuery(p.camera, p.aspect, p.bounds),
              ...(selected !== null ? { creature: selected } : {}),
            },
            controller.signal,
          );
        if (closed) return;
        setFrame(f);
        setPending(false);
        setStatus("connected");
        setError("");
        setLastRead(Date.now());
      } catch (e) {
        if (closed) return;
        failed = true;
        setPending(false);
        setStatus("stale");
        setError(
          source.kind === "demo"
            ? "The private demo could not start. Reopen it to retry."
            : e instanceof Error && e.message.includes("compatible")
              ? e.message
              : "Live access is unavailable from this origin. Check HTTPS and the server’s allowed origins, then reconnect.",
        );
      }
      if (!closed)
        timer = setTimeout(
          read,
          failed ? 5000 : source.kind === "demo" ? 250 : 1000,
        );
    };
    read();
    return () => {
      closed = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [source, selected, retry]);
  useEffect(() => {
    setCamera((c) => clampCamera(c, display.bounds, aspect));
  }, [aspect, display.bounds]);
  useEffect(() => {
    if (!following || !frame || selected === null) return;
    const r = frame.residents.find((r) => r.id === selected);
    if (!r) {
      setFollowing(false);
      return;
    }
    setCamera((c) =>
      clampCamera({ ...c, x: r.x + 0.5, y: r.y + 0.5 }, frame.bounds, aspect),
    );
  }, [frame, following, selected, aspect]);
  // Residents and inspector share one scroll container. A new panel or a new
  // resident opens at its top so the identity block is visible; refreshes of the
  // same inspector keep the reader's place. Runs before select()'s heading focus.
  useLayoutEffect(() => {
    if (panelScroll.current) panelScroll.current.scrollTop = 0;
  }, [side, selected]);
  const closePanel = useCallback(() => {
    setSide(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLCanvasElement>(".exp-canvas")
        ?.focus({ preventScroll: true }),
    );
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && side && !modal) closePanel();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [side, modal, closePanel]);
  const onAspect = useCallback((a: number, width: number) => {
    // Keep a resident's screen size when a desktop inspector takes map width.
    // Phone sheets change height only, so their zoom stays unchanged.
    const ratio=width/viewportWidth.current;
    viewportWidth.current=width;
    if(Math.abs(ratio-1)>.001) setCamera(c=>({...c,span:c.span*ratio}));
    setAspect(a);
  }, []);
  function choose(s: Source, remember = true) {
    viewportWidth.current=innerWidth;
    try { if(remember) {
      localStorage.setItem(
        VIEW_STORAGE,
        s.kind,
      );
      if (s.kind === "server") localStorage.setItem(STORAGE, s.url);
    }
    } catch {}
    setFrame(null);
    setSource(s);
    setSelected(null);
    setFollowing(false);
    setKnowledge(false);
    setPending(false);
    setPaused(false);
    setError("");
    setLastRead(null);
    setStatus(s.kind === "recording" ? "idle" : "connecting");
    setCamera({ x: 24, y: 24, span: innerWidth < 600 ? 9.5 : 22 });
    setSide(null);
    setModal(null);
  }
  const demo = () => choose({ kind: "demo", seed: 2 });
  function move(c: Camera) {
    setFollowing(false);
    setCamera(clampCamera(c, display.bounds, aspect));
  }
  function select(id: number, center = false) {
    setSelected(id);
    setPending(source.kind !== "recording");
    setSide("inspector");
    setKnowledge(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".exp-creature-head h2")
        ?.focus({ preventScroll: true }),
    );
    const r = display.residents.find((r) => r.id === id);
    if (r && (center || innerWidth <= 700))
      setCamera((c) =>
        clampCamera(
          { ...c, x: r.x + 0.5, y: r.y + 0.5 },
          display.bounds,
          aspect,
        ),
      );
  }
  const residents = display.residents.filter((r) =>
    `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const detail = display.inspector?.id === selected ? display.inspector : null;
  const selectedResident = display.residents.find((r) => r.id === selected);
  const authDemo = isolatedAuthDemo && source.kind === "server" && source.url === serverUrl;
  const connection =
    status === "connecting" && source.kind !== "recording"
      ? source.kind === "demo"
        ? "Opening demo"
        : "Connecting live"
      : recorded
        ? "Recorded preview"
        : source.kind === "demo"
          ? paused
            ? "Isolated demo · paused"
            : "Isolated demo"
          : status === "stale"
            ? "Connection interrupted"
            : authDemo
              ? "Isolated auth demo"
              : "Live world";
  const toggle = (s: typeof side) => setSide(side === s ? null : s);
  return (
    <div
      className={`exp-app ${side ? "has-panel" : ""}`}
      data-source={source.kind}
      data-display={recorded ? "recording" : source.kind}
      data-connection={status}
      data-tick={display.tick}
      data-auth-demo={authDemo}
    >
      <a className="skip-link" href="#exp-world">
        Skip to world
      </a>
      <header className="exp-header">
        <a className="exp-brand" href="#" aria-label="Stratoks home">
          <img className="exp-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="STRATOKS" width="162" height="40" />
        </a>
        <button
          className="exp-world-choice"
          onClick={() => setModal("settings")}
        >
          <Icon name="world" size={18} />
          <span>The Expanse</span>
          <Icon name="chevron" size={14} />
          <span className="sr-only">Choose world</span>
        </button>
        <div className="exp-live-status">
          <i
            className={status === "connected" && !recorded ? "connected" : ""}
          />
          <span>{connection}</span>
        </div>
        <div className="exp-header-actions">
          <VisitorWallet
            backendUrl={source.kind === "server" ? source.url : null}
            worldId={source.kind === "server" ? frame?.worldId ?? null : null}
            open={modal === "wallet"}
            onOpen={() => setModal("wallet")}
            onClose={() => setModal(null)}
          />
          <button
            className="exp-icon"
            aria-label="How this world works"
            onClick={() => setModal("help")}
          >
            <Icon name="help" />
          </button>
          <button
            className="exp-icon exp-duplicate-settings"
            aria-label="Choose world and connection"
            onClick={() => setModal("settings")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <div className="exp-statusbar" role="region" aria-label="World status">
        <span>
          <Icon name="people" size={15} />
          <b>{display.summary.population}</b> residents
        </span>
        <span className="exp-status-scope">
          {recorded ? "Recorded world totals" : "World totals"}
        </span>
        <details className="exp-diagnostics">
          <summary>
            <Icon name="clock" size={15} />
            <span>Diagnostics</span>
          </summary>
          <dl>
            <dt>Tick</dt><dd>{display.tick.toLocaleString()}</dd>
            <dt>Source</dt><dd>{recorded ? "Recording" : source.kind === "demo" ? `Isolated demo · seed ${source.seed}` : "Live server"}</dd>
            <dt>Updates</dt><dd>{source.kind === "server" && !recorded ? (lastRead ? "Polling every second" : "Waiting for first frame") : paused ? "Paused" : "Local worker"}</dd>
            <dt>View</dt><dd>{display.view.x0}, {display.view.y0} · {display.view.w}×{display.view.h} tiles</dd>
          </dl>
        </details>
        {source.kind === "demo" && (
          <button
            className="exp-text-button"
            onClick={() => {
              client.current?.pause(!paused);
              setPaused(!paused);
            }}
          >
            <Icon name={paused ? "play" : "pause"} size={14} />
            {paused ? "Resume demo" : "Pause demo"}
          </button>
        )}
      </div>
      <main className="exp-workspace" id="exp-world">
        <section className="exp-world-stage" aria-label="Explore the Expanse">
          <WorldMap
            frame={display}
            camera={camera}
            onCamera={move}
            onSelect={select}
            selected={selected}
            knowledge={knowledge}
            borders={borders}
            onAspect={onAspect}
            motion={visualMotion && !reduced}
            recorded={recorded}
          />
          {/* Compact contextual control: place + climate + the main action. */}
          <div className="exp-context">
            <span className="exp-leaf-mark" aria-hidden="true">
              <Icon name="leaf" size={16} />
            </span>
            <h1>{BIOME_NAMES[display.view.biome] ?? "The Expanse"}</h1>
            <span className="exp-context-climate">{display.view.climate ? `${display.view.climate.temperature} °C${display.view.climate.rain ? " · Rain" : ""}` : "Recorded terrain"}</span>
            {recorded && (
              <button
                className="exp-context-action"
                onClick={demo}
                disabled={source.kind === "demo" && status === "connecting"}
              >
                <Icon name="play" size={15} />
                {source.kind === "demo" && status === "connecting" ? "Opening…" : "Explore demo"}
              </button>
            )}
            <button
              className={`exp-context-action ${!recorded ? "primary" : ""}`}
              onClick={() => toggle("residents")}
            >
              <Icon name="search" size={15} />
              Find residents
            </button>
          </div>
          <nav className="exp-tool-rail" aria-label="World tools">
            <button
              aria-label="Find residents"
              aria-pressed={side === "residents"}
              onClick={() => toggle("residents")}
            >
              <Icon name="people" />
            </button>
            <button
              aria-label="View world records"
              aria-pressed={side === "records"}
              onClick={() => toggle("records")}
            >
              <Icon name="history" />
            </button>
            <button aria-label="Explore settlements" aria-pressed={side === "places"} onClick={() => toggle("places")}>
              <Icon name="home" />
            </button>
            <span />
            <button
              aria-label="Show chunk boundaries"
              aria-pressed={borders}
              onClick={() => setBorders(!borders)}
            >
              <Icon name="world" />
            </button>
            <button
              aria-label={
                visualMotion ? "Pause visual motion" : "Resume visual motion"
              }
              aria-pressed={!visualMotion}
              onClick={() => setVisualMotion(!visualMotion)}
            >
              <Icon name={visualMotion ? "pause" : "play"} />
            </button>
            {selected !== null && (
              <button
                aria-label="Open selected resident"
                aria-pressed={side === "inspector"}
                onClick={() => toggle("inspector")}
              >
                <Icon name="eye" />
              </button>
            )}
          </nav>
          <div className="exp-scene-messages">
          <div className="exp-scene-notice" role="status">
            {error ? (
              <>
                <Icon name="signal" size={17} />
                <span>
                  {source.kind === "demo"
                    ? "Private demo unavailable. Showing the last received state."
                    : source.kind === "recording"
                      ? "Check the live server settings."
                      : frame
                        ? "Connection interrupted. Showing the last received state."
                        : "Live connection unavailable. Showing a recorded preview."}
                </span>
                <button
                  onClick={() => {
                    if (source.kind === "recording") setModal("settings");
                    else if (source.kind === "demo") demo();
                    else {
                      setStatus("connecting");
                      setRetry((r) => r + 1);
                    }
                  }}
                  className="exp-text-button"
                >
                  {source.kind === "recording"
                    ? "Choose world"
                    : source.kind === "demo"
                      ? "Reopen demo"
                      : "Reconnect"}
                </button>
              </>
            ) : recorded &&
              status === "connecting" &&
              source.kind !== "recording" ? (
              <>
                <Icon name="signal" size={17} />
                <span>
                  {source.kind === "demo"
                    ? "Opening the private demo…"
                    : "Connecting live…"}{" "}
                  Recorded preview is shown.
                </span>
                <button
                  className="exp-text-button"
                  onClick={() => choose({ kind: "recording" })}
                >
                  Cancel connection
                </button>
              </>
            ) : recorded ? (
              <>
                <Icon name="history" size={17} />
                <span>Recorded world · no live simulation</span>
                <button
                  className="exp-text-button"
                  onClick={() =>
                    choose({ kind: "server", url: validateServer(serverUrl) })
                  }
                >
                  Connect live
                </button>
              </>
            ) : source.kind === "demo" ? (
              <>
                <Icon name="shield" size={17} />
                <span>Isolated demo · seed 2 · resets on exit</span>
                <button
                  className="exp-text-button"
                  onClick={() => choose({ kind: "recording" })}
                >
                  Exit demo
                </button>
              </>
            ) : (
              <>
                <Icon name="signal" size={17} />
                <span>
                  {authDemo ? "Isolated auth demo" : display.worldId ?? "Shared world"} ·{" "}
                  {BIOME_NAMES[display.view.biome] ?? display.view.biome}
                </span>
              </>
            )}
          </div>
          {following && selectedResident && (
            <button
              className="exp-follow-banner"
              onClick={() => setFollowing(false)}
            >
              <Icon name="center" size={16} />
              Following {selectedResident.name}
              <Icon name="close" size={14} />
            </button>
          )}
          </div>
          <MiniMap
            frame={display}
            camera={camera}
            onCamera={move}
            aspect={aspect}
          />
        </section>
        {side && (
          <aside
            className={`exp-side-panel ${side === "inspector" ? "exp-inspector-panel" : ""}`}
            aria-label={
              side === "residents"
                ? "Residents"
                : side === "records"
                  ? "World records"
                  : side === "places" ? "Settlements" : "Resident inspector"
            }
          >
            <div className="exp-panel-title">
              <h2>
                {side === "residents"
                  ? "Residents"
                  : side === "records"
                    ? "World records"
                    : side === "places" ? "Settlements" : "Resident inspector"}
              </h2>
              <button
                className="exp-icon"
                aria-label="Close panel"
                onClick={closePanel}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="exp-panel-scroll" ref={panelScroll}>
              {side === "inspector" && (
                <CreatureInspector
                  key={selected ?? "empty"}
                  detail={detail}
                  resident={selectedResident}
                  recorded={recorded}
                  selected={selected}
                  pending={pending}
                  tick={display.tick}
                  follow={following}
                  onFollow={() => {
                    setFollowing(!following);
                    if (!following && selectedResident)
                      setCamera((c) =>
                        clampCamera(
                          {
                            ...c,
                            x: selectedResident.x + 0.5,
                            y: selectedResident.y + 0.5,
                          },
                          display.bounds,
                          aspect,
                        ),
                      );
                  }}
                  onKnowledge={() => setKnowledge(!knowledge)}
                  knowledge={knowledge}
                  onDemo={demo}
                  connected={!recorded}
                />
              )}
              {side === "residents" && (
                <>
                  <div className="exp-list-toolbar">
                    <label htmlFor="resident-search" className="exp-small">
                      Search residents
                    </label>
                    <div className="exp-search">
                      <Icon name="search" size={18} />
                      <input
                        id="resident-search"
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Name or ID"
                        aria-label="Search residents"
                        autoComplete="off"
                      />
                    </div>
                    <p className="exp-small exp-muted">
                      {residents.length} of {display.residents.length} living
                      residents{recorded ? " · recorded" : ""}
                    </p>
                  </div>
                  <div className="exp-residents">
                    {residents.map((r) => (
                      <button
                        key={r.id}
                        className="exp-resident"
                        aria-pressed={selected === r.id}
                        onClick={() => select(r.id, true)}
                      >
                        <Portrait id={r.id} size={44} />
                        <span>
                          <strong>{r.name}</strong>
                          <span>
                            #{r.id} · {r.action ?? "Between actions"}
                          </span>
                        </span>
                        <Icon name="chevron" size={16} />
                      </button>
                    ))}
                  </div>
                  {!residents.length && (
                    <div className="exp-empty">
                      <p>No residents match this search.</p>
                      <button
                        className="exp-button"
                        onClick={() => setSearch("")}
                      >
                        Clear search
                      </button>
                    </div>
                  )}
                </>
              )}
              {side === "places" && (
                <div className="exp-places">
                  <p className="exp-small exp-muted">Structures from this world’s history. Travel here moves only your camera.</p>
                  <label htmlFor="place-biome">Explore a biome</label>
                  <select id="place-biome" value={placeBiome} onChange={e=>setPlaceBiome(e.target.value)}>
                    <option value="all">All biomes</option>
                    {Object.entries(BIOME_NAMES).map(([key,name])=><option key={key} value={key}>{name}</option>)}
                  </select>
                  {['temperate','arid','cold','coast'].filter(b=>placeBiome==='all'||placeBiome===b).map(b=>{
                    const places=(display.places ?? []).filter(p=>p.biome===b);
                    return <section key={b} className="exp-place-group">
                      <h3><i style={{background:{temperate:'#729451',arid:'#d5bb82',cold:'#d2e2e3',coast:'#65b4b3'}[b]}} />{BIOME_NAMES[b]}</h3>
                      <p className="exp-small exp-muted">{display.summary.byBiome[b] ?? 0} residents · {places.filter(p=>p.complete&&p.integrity>0).length} standing shelters</p>
                      {places.length ? places.filter((p,i,a)=>a.findIndex(q=>Math.hypot(p.x-q.x,p.y-q.y)<10)===i).slice(0,8).map(p=><button key={p.id} className="exp-place" onClick={()=>{move({...camera,x:p.x+.5,y:p.y+.5,span:(innerWidth<600?10:18)*viewportWidth.current/innerWidth});closePanel();}}>
                        <Icon name="home" size={18}/><span><strong>{p.kind.replaceAll('_',' ')} · #{p.id}</strong><span>{p.x}, {p.y} · {p.complete?(p.integrity>0?`${p.integrity}% integrity`:'Ruined'):'Under construction'} · {p.stored} stored</span></span><Icon name="chevron" size={16}/>
                      </button>) : <p className="exp-small">No structures recorded here. Use the atlas to explore the wilderness.</p>}
                    </section>;
                  })}
                  <p className="exp-small exp-muted">The atlas shows materialized terrain, which may include observer views. Agent knowledge is individual; inspect Perception to see it.</p>
                </div>
              )}
              {side === "records" && (
                <div className="exp-records">
                  <p className="exp-small exp-muted">
                    World totals at tick {display.tick.toLocaleString()}
                    {recorded ? " · recorded" : ""}. Retained history has a
                    bounded scope.
                  </p>
                  <dl className="exp-world-totals">
                    <div>
                      <dt>Shelters</dt>
                      <dd>{display.summary.shelters}</dd>
                    </div>
                    <div>
                      <dt>Fires</dt>
                      <dd>{display.summary.fires}</dd>
                    </div>
                    <div>
                      <dt>Births</dt>
                      <dd>{display.summary.births}</dd>
                    </div>
                    <div>
                      <dt>Deaths</dt>
                      <dd>{display.summary.deaths}</dd>
                    </div>
                  </dl>
                  {display.view.living && <dl className="exp-world-totals">
                    <div><dt>Building sites</dt><dd>{display.summary.sites ?? "Unavailable"}</dd></div>
                    <div><dt>Stored units</dt><dd>{display.summary.stored ?? "Unavailable"}</dd></div>
                    <div><dt>Fish gathered</dt><dd>{display.summary.fishCaught ?? "Unavailable"}</dd></div>
                    <div><dt>Standing shelters</dt><dd>{display.summary.standing ?? "Unavailable"}</dd></div>
                  </dl>}
                  <details className="exp-details" open>
                    <summary>
                      Discoveries · latest {display.discoveries.length} / 200
                    </summary>
                    {display.discoveries.length ? (
                      <ol className="exp-history">
                        {display.discoveries
                          .slice()
                          .reverse()
                          .map((d, i) => (
                            <li key={i}>
                              <strong>{d.what.replaceAll("_", " ")}</strong>
                              <span>
                                #{d.by} · tick {d.tick} ·{" "}
                                {d.selfFound
                                  ? "Self found"
                                  : "Observed previously"}
                                {d.firstInWorld
                                  ? " · First in retained world history"
                                  : ""}
                              </span>
                              <button
                                className="exp-text-button"
                                disabled={
                                  !display.residents.some((r) => r.id === d.by)
                                }
                                onClick={() => select(d.by, true)}
                              >
                                Inspect #{d.by}
                              </button>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className="exp-small">No discoveries recorded.</p>
                    )}
                  </details>
                  <details className="exp-details">
                    <summary>
                      Social outcomes · latest {display.social.length} / 100
                    </summary>
                    {display.social.length ? (
                      <ol className="exp-history">
                        {display.social
                          .slice()
                          .reverse()
                          .map((s, i) => (
                            <li key={i}>
                              <strong>
                                #{s.actor} · {s.type}
                                {s.target ? ` → #${s.target}` : ""}
                              </strong>
                              <span>
                                {typeof s.result === "string"
                                  ? s.result
                                  : JSON.stringify(s.result)}
                              </span>
                              <span>Tick {s.tick}</span>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className="exp-small">No social outcomes recorded.</p>
                    )}
                  </details>
                  <p className="exp-small exp-muted">
                    World ID: {display.worldId ?? "Not supplied"}
                    <br />
                    Seed: {display.seed}
                  </p>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
      <footer className="exp-footer">
        <span>
          <Icon name="eye" size={14} />
          Observer view
        </span>
        <span className="exp-footer-instructions">
          Drag to pan · Scroll or pinch to zoom · Select a resident
        </span>
        <span>
          {Math.round(camera.x)}, {Math.round(camera.y)}
          <span className="exp-footer-world">
            {" "}
            ·{" "}
            {recorded
              ? "Recorded"
              : source.kind === "demo"
                ? "Private demo"
                : authDemo ? "Isolated auth demo" : "Shared world"}
          </span>
        </span>
      </footer>
      {modal === "settings" && (
        <Modal title="Choose world" onClose={() => setModal(null)}>
          <WorldSettings
            current={source}
            serverUrl={serverUrl}
            onChoose={(s) => {
              if (s.kind === "server") {
                setServerUrl(s.url);
                try {
                  localStorage.setItem(STORAGE, s.url);
                } catch {}
              }
              choose(s);
            }}
          />
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="A world to observe" onClose={() => setModal(null)}>
          <div className="exp-help">
            <Portrait size={96} />
            <a href={`${import.meta.env.BASE_URL}art/model.webp`} target="_blank" rel="noreferrer">View the Stratok model sheet</a>
            <p>
              These creatures learn from the outcomes of their actions. Watch
              their lives unfold, then select a resident to inspect the
              evidence.
            </p>
            <h3>Wander</h3>
            <p>
              Drag or use arrow keys to pan. Scroll, pinch, or use + / − to
              zoom. Select a resident on the map or use Find residents. The
              atlas takes you to another part of this same world.
            </p>
            <h3>Read the evidence</h3>
            <p>
              Plans compare predictions with outcomes. Perception is the last
              decision observation. Learning shows retained memories and
              updates. No thoughts or speech are invented.
            </p>
            <h3>Three separate views</h3>
            <p>
              Live reads the owner’s server. Recorded preview is a frozen API capture.
              The default isolated demo resumes seed 2 after {demoManifest.tick.toLocaleString()} natural engine ticks,
              then runs privately in this browser. It resets on exit and never writes to the shared world.
            </p>
            <button
              className="exp-button"
              aria-pressed={!visualMotion}
              onClick={() => setVisualMotion(!visualMotion)}
            >
              {visualMotion ? "Pause visual motion" : "Resume visual motion"}
            </button>
            {reduced && (
              <p className="exp-small exp-muted">
                Reduced motion is active. Positions update without interpolation
                or sprite animation.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function WorldSettings({
  current,
  serverUrl,
  onChoose,
}: {
  current: Source;
  serverUrl: string;
  onChoose: (s: Source) => void;
}) {
  const [url, setUrl] = useState(() => {
      try {
        return localStorage.getItem(STORAGE) ?? serverUrl;
      } catch {
        return serverUrl;
      }
    }),
    [error, setError] = useState("");
  return (
    <div className="exp-settings">
      <p>Observe the owner’s world, or explore a separate browser simulation.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onChoose({ kind: "server", url: validateServer(url) });
          } catch (e) {
            setError((e as Error).message);
            document.getElementById("exp-server")?.focus();
          }
        }}
      >
        <label htmlFor="exp-server">Live server URL</label>
        <input
          id="exp-server"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://world.example"
          autoComplete="url"
          required
          aria-invalid={!!error}
          aria-describedby="exp-server-note exp-server-error"
        />
        <p id="exp-server-note" className="exp-small exp-muted">
          Static previews need the server to allow their origin. Same-origin
          owner installations can use live mode in expanse-config.json.
        </p>
        <p id="exp-server-error" className="exp-form-error" role="status">
          {error}
        </p>
        <button className="exp-button primary" type="submit">
          <Icon name="signal" size={17} />
          {current.kind === "server"
            ? "Reconnect live world"
            : "Connect live world"}
        </button>
      </form>
      <div className="exp-world-options">
        <button
          className="exp-world-option"
          onClick={() => onChoose({ kind: "recording" })}
        >
          <Icon name="history" />
          <span>
            <strong>Open recorded preview</strong>
            <span>A frozen capture of the existing world.</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button
          className="exp-world-option"
          onClick={() => onChoose({ kind: "demo", seed: 2 })}
        >
          <Icon name="leaf" />
          <span>
            <strong>Explore isolated demo</strong>
            <span>Resumes {demoManifest.tick.toLocaleString()} ticks of seed 2 with the updated engine. Resets on exit.</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <p className="exp-small exp-muted">
        The isolated demo uses the updated engine. An older live server may not expose goals, signals or crops. No account or payment is needed.
      </p>
    </div>
  );
}
