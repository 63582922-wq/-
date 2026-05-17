import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "./i18n";

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechFailureKind = "empty" | "not-allowed" | "network";

export function useSpeechToText(locale: Locale) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTextRef = useRef<(text: string) => void>(() => {});
  const onFailureRef = useRef<(kind: SpeechFailureKind) => void>(() => {});
  const deliveredRef = useRef(false);

  const supported = Boolean(getSpeechRecognition());

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setUnsupported(true);
      return;
    }
    stop();
    deliveredRef.current = false;
    const rec = new Ctor();
    rec.lang = locale === "zh" ? "zh-CN" : "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event: SpeechRecognitionEvent) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i]?.[0]?.transcript?.trim();
        if (t) parts.push(t);
      }
      const text = parts.join(" ").trim();
      if (!text) return;
      deliveredRef.current = true;
      onTextRef.current(text);
    };
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        onFailureRef.current("not-allowed");
        deliveredRef.current = true;
      } else if (code === "network") {
        onFailureRef.current("network");
        deliveredRef.current = true;
      }
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onend = () => {
      if (!deliveredRef.current) onFailureRef.current("empty");
      deliveredRef.current = false;
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setUnsupported(false);
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }, [locale, stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => stop(), [stop]);

  const bindOnTranscript = useCallback((fn: (text: string) => void) => {
    onTextRef.current = fn;
  }, []);

  const bindOnFailure = useCallback((fn: (kind: SpeechFailureKind) => void) => {
    onFailureRef.current = fn;
  }, []);

  return useMemo(
    () => ({ supported, unsupported, listening, toggle, stop, bindOnTranscript, bindOnFailure }),
    [supported, unsupported, listening, toggle, stop, bindOnTranscript, bindOnFailure],
  );
}
