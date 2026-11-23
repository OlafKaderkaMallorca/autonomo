"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ablehnen, annehmen, type EntscheidungsZustand } from "./aktionen";

export interface EntscheidungsTexte {
  name: string;
  unterschrift: string;
  loeschen: string;
  zustimmung: string;
  annehmen: string;
  ablehnen: string;
  ablehnenFrage: string;
  grund: string;
  fehler: Record<NonNullable<EntscheidungsZustand["fehler"]>, string>;
}

/** Unterschriftsfeld für Finger, Stift oder Maus; liefert ein PNG als Data-URL. */
function Unterschriftsfeld({ beschriftung, loeschenText, onAenderung }: { beschriftung: string; loeschenText: string; onAenderung: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const zeichnet = useRef(false);
  const [leer, setLeer] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const skala = window.devicePixelRatio || 1;
    c.width = c.clientWidth * skala;
    c.height = c.clientHeight * skala;
    const ctx = c.getContext("2d")!;
    ctx.scale(skala, skala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const punkt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <label>{beschriftung}</label>
      <canvas
        ref={canvas}
        className="unterschrift-feld"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          zeichnet.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = punkt(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!zeichnet.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = punkt(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          zeichnet.current = false;
          setLeer(false);
          onAenderung(e.currentTarget.toDataURL("image/png"));
        }}
      />
      {!leer && (
        <button
          type="button"
          className="leise klein"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setLeer(true);
            onAenderung("");
          }}
        >
          {loeschenText}
        </button>
      )}
    </div>
  );
}

export function Entscheidung({ token, texte }: { token: string; texte: EntscheidungsTexte }) {
  const [png, setPng] = useState("");
  const [zeigeAblehnen, setZeigeAblehnen] = useState(false);
  const [annahme, annahmeAktion, annahmeLaeuft] = useActionState<EntscheidungsZustand, FormData>(annehmen.bind(null, token), {});
  const [ablehnung, ablehnungAktion, ablehnungLaeuft] = useActionState<EntscheidungsZustand, FormData>(ablehnen.bind(null, token), {});

  return (
    <>
      <form action={annahmeAktion} className="karte">
        <label htmlFor="name">{texte.name}</label>
        <input id="name" name="name" autoComplete="name" required minLength={2} />
        <Unterschriftsfeld beschriftung={texte.unterschrift} loeschenText={texte.loeschen} onAenderung={setPng} />
        <input type="hidden" name="unterschrift" value={png} />
        <p className="hinweis">{texte.zustimmung}</p>
        <button disabled={annahmeLaeuft || !png}>{texte.annehmen}</button>
        {annahme.fehler && <p className="fehler">{texte.fehler[annahme.fehler]}</p>}
      </form>
      {!zeigeAblehnen ? (
        <button type="button" className="leise" onClick={() => setZeigeAblehnen(true)}>
          {texte.ablehnen}
        </button>
      ) : (
        <form action={ablehnungAktion} className="karte">
          <p>{texte.ablehnenFrage}</p>
          <label htmlFor="grund">{texte.grund}</label>
          <input id="grund" name="grund" maxLength={1000} />
          <button className="leise" disabled={ablehnungLaeuft}>
            {texte.ablehnen}
          </button>
          {ablehnung.fehler && <p className="fehler">{texte.fehler[ablehnung.fehler]}</p>}
        </form>
      )}
    </>
  );
}
