import { FormEvent, useEffect, useMemo, useState } from "react";
import { messageHasExtractableBirthDate } from "./date-parse";
import {
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
  t,
} from "./i18n";
import LunarBirthField from "./lunar-birth-field";

/** 须与 web/backend/main.py 中 API_BUILD_MARK 保持一致 */
const EXPECTED_API_BUILD_MARK = "reply-source-v9";

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
}

type FusionGroup = {
  label: string;
  code: string;
  digits: number[];
  形: {
    digit: number;
    卦象节气时辰: string;
    核心物理属性: string;
    阳面: string[];
    阴面: string[];
  };
  质_后两位: {
    pair: string;
    root: number;
    lines: string[];
    in_chart: boolean;
    fallback_digits?: unknown[];
  };
  形质联结?: { pair: string; lines: string[] };
};

type AgentPayload = {
  birth: { y: number; m: number; d: number };
  triangle: Record<string, unknown>;
  fusion_codes_outer3: string[];
  fusion_codes_inner3?: string[];
  fusion_labels: string[];
  fusion_inner_labels?: string[];
  interpretation_frame?: string;
  algorithm_note?: string;
  inner_top_digit: FusionGroup["形"];
  fusion_groups: FusionGroup[];
  inner_fusion_groups?: FusionGroup[];
  disclaimer: string;
  assistant_reply?: string;
  personality_synthesis?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** 两条链路：先本地再在气泡链里请求模型 */
  step?:
    | "local_compute"
    | "local_result"
    | "ai_loading"
    /** 本地 + 大模型合并为一条气泡，减少层级嵌套 */
    | "combined_report"
    /** 基于同一测算的多轮追问回复 */
    | "followup_chat";
  payload?: AgentPayload;
  error?: string;
  /** 模型失败但仍有本地正文时由服务端下发 */
  modelWarning?: string;
  /** model=大模型；fallback=本地整合文稿 */
  replySource?: "model" | "fallback";
  /** 等待模型响应中的占位气泡 */
  loading?: boolean;
  /** 成功走模型时服务端返回的耗时与模型名（用于核对确实请求过 API） */
  generationMeta?: {
    elapsed_seconds: number;
    model: string;
    api_host: string;
  };
};

type ChatTurnApi = { role: "user" | "assistant"; content: string };

function formatBirthIso(b: { y: number; m: number; d: number }): string {
  return `${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")}`;
}

/** 供给 /api/chat 的 history：不含当前正在发送的这一条用户话。 */
function buildApiHistory(msgs: ChatMessage[]): ChatTurnApi[] {
  const out: ChatTurnApi[] = [];
  let seenUser = false;
  for (const m of msgs) {
    if (m.role === "user") {
      const c = m.content.trim();
      if (!c) continue;
      seenUser = true;
      out.push({ role: "user", content: c });
      continue;
    }
    if (m.role === "assistant") {
      if (!seenUser) continue;
      if (m.loading) continue;
      if (m.error) continue;
      const c = m.content.trim();
      if (!c) continue;
      if (
        m.step === "local_compute" ||
        m.step === "local_result" ||
        m.step === "ai_loading"
      ) {
        continue;
      }
      out.push({ role: "assistant", content: c });
    }
  }
  return out;
}

async function fetchLocalPayload(
  message: string,
  birthDate: string,
  locale: Locale,
): Promise<{ ok: true; payload: AgentPayload } | { ok: false; error: string }> {
  const res = await fetch("/api/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      message,
      birth_date: birthDate.trim() || null,
      locale,
    }),
  });
  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: t(locale, "serviceUnavailable") };
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: t(locale, "backendNoCompute"),
    };
  }
  if (!res.ok) {
    const detail = data.detail;
    let msg: string;
    if (typeof detail === "string") {
      msg = detail;
    } else if (Array.isArray(detail)) {
      msg = detail.map((x) => JSON.stringify(x)).join("; ");
    } else if (detail != null && typeof detail === "object") {
      msg = JSON.stringify(detail);
    } else {
      msg = `HTTP ${res.status}`;
    }
    return {
      ok: false,
      error: msg || `${t(locale, "requestFailed")} (HTTP ${res.status})`,
    };
  }
  const payload = data.payload as AgentPayload | undefined;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: t(locale, "computeInvalidPayload"),
    };
  }
  return { ok: true, payload };
}

async function sendChat(params: {
  message: string;
  birthDate: string;
  history?: ChatTurnApi[];
  /** 与后端 ChatBody.client_followup 一致：追问轮须为 true，避免 history 异常时重复走首轮要点。 */
  clientFollowup?: boolean;
  locale: Locale;
}): Promise<ChatMessage> {
  const { message, birthDate, history = [], clientFollowup = false, locale } =
    params;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      message,
      birth_date: birthDate.trim() || null,
      history,
      client_followup: clientFollowup,
      locale,
    }),
  });
  const replySrcHeader = (res.headers.get("X-Reply-Source") ?? "").trim();
  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return {
      role: "assistant",
      content: "",
      error: t(locale, "serviceUnavailable"),
    };
  }
  if (!res.ok) {
    const detail = data.detail;
    let msg: string;
    if (typeof detail === "string") {
      msg = detail;
    } else if (Array.isArray(detail)) {
      msg = detail.map((x) => JSON.stringify(x)).join("; ");
    } else if (detail != null && typeof detail === "object") {
      msg = JSON.stringify(detail);
    } else {
      msg = `HTTP ${res.status}`;
    }
    return {
      role: "assistant",
      content: "",
      error: msg || `${t(locale, "requestFailed")} (HTTP ${res.status})`,
    };
  }
  if (data.error) {
    return {
      role: "assistant",
      content: "",
      error: String(data.error),
      payload: data.payload as AgentPayload | undefined,
    };
  }
  /** 用于展示「模型耗时 / 模型名」等附注；不再用缺字段来挡住正文。 */
  const gmRaw = data.generation_meta as Record<string, unknown> | undefined;
  const generationMeta =
    gmRaw &&
    typeof gmRaw.elapsed_seconds === "number" &&
    typeof gmRaw.model === "string" &&
    typeof gmRaw.api_host === "string"
      ? {
          elapsed_seconds: gmRaw.elapsed_seconds,
          model: gmRaw.model,
          api_host: gmRaw.api_host,
        }
      : undefined;
  const rs = data.reply_source;
  const effectiveModel =
    replySrcHeader === "model" ||
    rs === "model" ||
    Boolean(generationMeta);

  const replyText = String(data.reply ?? "");
  const serverMw =
    typeof data.model_warning === "string" ? data.model_warning : undefined;
  const fallbackMw =
    rs === "fallback" ? t(locale, "modelFallbackWarning") : undefined;

  return {
    role: "assistant",
    content: replyText,
    payload: data.payload as AgentPayload | undefined,
    modelWarning: serverMw ?? fallbackMw,
    replySource: effectiveModel ? "model" : rs === "fallback" ? "fallback" : undefined,
    generationMeta,
  };
}

function TriangleCard({ tri }: { tri: Record<string, unknown> }) {
  const pretty = useMemo(() => JSON.stringify(tri, null, 2), [tri]);
  return <pre className="app-triangle-pre">{pretty}</pre>;
}

function GroupCard({ g, locale }: { g: FusionGroup; locale: Locale }) {
  return (
    <article className="card-group">
      <header>
        {g.label} · <code>{g.code}</code>
      </header>
      <p style={{ margin: "0 0 8px" }}>
        {locale === "zh"
          ? `形（首位 ${g.形.digit}）：${g.形.卦象节气时辰}`
          : `Form (first digit ${g.形.digit}): ${g.形.卦象节气时辰}`}
      </p>
      <ul>
        <li>
          {t(locale, "groupYang")}
          {g.形.阳面.join("；")}
        </li>
        <li>
          {t(locale, "groupYin")}
          {g.形.阴面.join("；")}
        </li>
      </ul>
      <p style={{ margin: "12px 0 6px", fontWeight: 600, color: "var(--text)" }}>
        {locale === "zh"
          ? `质（后两位 ${g.质_后两位.pair} → 根 ${g.质_后两位.root}）`
          : `Substance (last two ${g.质_后两位.pair} → root ${g.质_后两位.root})`}
      </p>
      <ul>
        {g.质_后两位.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {g.形质联结 && (
        <>
          <p style={{ margin: "12px 0 6px", fontWeight: 600, color: "var(--text)" }}>
            {t(locale, "groupLink")}
            {g.形质联结.pair}）
          </p>
          <ul>
            {g.形质联结.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

function LogicSummary({ p, locale }: { p: AgentPayload; locale: Locale }) {
  const { y, m, d } = p.birth;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const outer = p.fusion_codes_outer3.join(" · ");
  const inner =
    p.fusion_codes_inner3 && p.fusion_codes_inner3.length > 0
      ? p.fusion_codes_inner3.join(" · ")
      : "—";
  return (
    <div className="logic-summary">
      <div className="logic-summary-row">
        {t(locale, "logicSolar")} <code>{iso}</code>
      </div>
      <div className="logic-summary-row">
        {t(locale, "logicOuter")} <code>{outer}</code>
      </div>
      <div className="logic-summary-row">
        {t(locale, "logicInner")} <code>{inner}</code>
      </div>
      <div className="logic-summary-row">
        {t(locale, "logicVertex")} <code>{String(p.inner_top_digit.digit)}</code>
      </div>
    </div>
  );
}

/** 推演明细与讲义原文，可与上文解读对照。 */
function StructuredAppendix({
  p,
  locale,
  omitPersonalitySynthesis,
  omitLogicSummary,
}: {
  p: AgentPayload;
  locale: Locale;
  omitPersonalitySynthesis?: boolean;
  omitLogicSummary?: boolean;
}) {
  return (
    <div className="structured-appendix">
      {!omitLogicSummary ? <LogicSummary p={p} locale={locale} /> : null}
      <details className="app-details">
        <summary>{t(locale, "detailsRules")}</summary>
        <div className="details-body">
          {p.algorithm_note ? (
            <div className="note-muted" style={{ marginBottom: 12 }}>
              {p.algorithm_note}
            </div>
          ) : null}
          <TriangleCard tri={p.triangle} />
        </div>
      </details>
      <p className="digit-line">
        {t(locale, "digitLinePrefix")} {p.inner_top_digit.digit} · {p.inner_top_digit.卦象节气时辰}
      </p>
      {p.interpretation_frame && (
        <div className="note-muted">{p.interpretation_frame}</div>
      )}
      {p.inner_fusion_groups && p.inner_fusion_groups.length > 0 && (
        <>
          <div className="section-label">{t(locale, "sectionInner")}</div>
          {p.inner_fusion_groups.map((g) => (
            <GroupCard key={`in-${g.code + g.label}`} g={g} locale={locale} />
          ))}
        </>
      )}
      <div className="section-label">{t(locale, "sectionOuter")}</div>
      {p.fusion_groups.map((g) => (
        <GroupCard key={g.code + g.label} g={g} locale={locale} />
      ))}
      {p.personality_synthesis && !omitPersonalitySynthesis ? (
        <details className="app-details" style={{ marginTop: 12 }}>
          <summary>{t(locale, "personalityTemplateDetails")}</summary>
          <div className="details-body">
            <div className="report-flow">{p.personality_synthesis}</div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function bubbleClass(msg: ChatMessage): string {
  const base = "app-bubble";
  if (msg.role === "user") return `${base} app-bubble--user`;
  if (msg.role === "assistant" && msg.loading) return `${base} app-bubble--pending`;
  if (msg.error) return `${base} app-bubble--error`;
  if (
    msg.role === "assistant" &&
    msg.payload &&
    (msg.step === "combined_report" || msg.step === "followup_chat")
  ) {
    return `${base} app-bubble--result`;
  }
  return base;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: "assistant", content: t(readStoredLocale(), "welcomeIntro") },
  ]);
  const [input, setInput] = useState("");
  /** 最近一次成功测算的阳历 ISO，用于无日期时的追问与重算。 */
  const [lockedBirthIso, setLockedBirthIso] = useState("");
  const [birthPicker, setBirthPicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitHint, setSubmitHint] = useState("");
  const [backendBanner, setBackendBanner] = useState<string | null>(null);

  function flipLocale() {
    const next: Locale = locale === "zh" ? "en" : "zh";
    setLocale(next);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].role === "assistant" && !prev[0].payload) {
        return [{ role: "assistant", content: t(next, "welcomeIntro") }];
      }
      return prev;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setBackendBanner(null);
    (async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        if (cancelled) return;
        if (r.status === 404) {
          setBackendBanner(t(locale, "backendBanner404"));
          return;
        }
        if (!r.ok) return;
        const j = (await r.json()) as { build_mark?: string };
        if (j.build_mark !== EXPECTED_API_BUILD_MARK) {
          setBackendBanner(t(locale, "backendBannerVersion"));
        }
      } catch {
        /* 未启动后端或纯静态预览 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    const iso = birthPicker.trim();
    const hasDateInMessage = messageHasExtractableBirthDate(text);
    const canResolveBirth =
      hasDateInMessage ||
      Boolean(iso) ||
      (Boolean(lockedBirthIso) && Boolean(text) && !hasDateInMessage);
    if (!canResolveBirth) {
      setSubmitHint(t(locale, "submitHintNoBirth"));
      return;
    }
    const userLine = text || (iso ? `${t(locale, "computeSolarPrefix")} ${iso}` : "");
    if (!userLine.trim()) {
      setSubmitHint(t(locale, "submitHintEmpty"));
      return;
    }
    setSubmitHint("");

    const birthFromPicker = hasDateInMessage ? "" : text ? lockedBirthIso || iso : iso;
    const followUpOnly =
      Boolean(lockedBirthIso) && Boolean(text) && !hasDateInMessage;

    const historyForApi = buildApiHistory(messages);

    const stripLoading = (prev: ChatMessage[]) =>
      prev.filter((m) => !(m.role === "assistant" && m.loading));

    if (followUpOnly) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: userLine },
        {
          role: "assistant",
          content: t(locale, "loadingReply"),
          loading: true,
          step: "ai_loading",
        },
      ]);
      setInput("");
      setBusy(true);
      try {
        const first = await fetchLocalPayload(text, lockedBirthIso, locale);
        if (!first.ok) {
          setMessages((prev) => [
            ...stripLoading(prev),
            { role: "assistant", content: "", error: first.error },
          ]);
          return;
        }
        const birthThisRound = formatBirthIso(first.payload.birth);
        setLockedBirthIso(birthThisRound);
        const reply = await sendChat({
          message: text,
          birthDate: birthThisRound,
          history: historyForApi,
          clientFollowup: true,
          locale,
        });
        setMessages((prev) => [
          ...stripLoading(prev),
          {
            role: "assistant",
            step: "followup_chat",
            payload: first.payload,
            content: reply.content,
            error: reply.error,
            modelWarning: reply.modelWarning,
            replySource: reply.replySource,
            generationMeta: reply.generationMeta,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...stripLoading(prev),
          {
            role: "assistant",
            content: "",
            error: t(locale, "networkError"),
          },
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userLine },
      {
        role: "assistant",
        content: t(locale, "loadingLocal"),
        loading: true,
        step: "local_compute",
      },
    ]);
    setInput("");
    setBusy(true);
    let localPayload: AgentPayload | undefined;

    try {
      const first = await fetchLocalPayload(text, birthFromPicker, locale);
      if (!first.ok) {
        setMessages((prev) => [
          ...stripLoading(prev),
          { role: "assistant", content: "", error: first.error },
        ]);
        return;
      }
      localPayload = first.payload;
      setLockedBirthIso(formatBirthIso(first.payload.birth));
      setMessages((prev) => [
        ...stripLoading(prev),
        {
          role: "assistant",
          payload: first.payload,
          content: "",
          step: "local_result",
        },
      ]);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t(locale, "loadingAi"),
          loading: true,
          step: "ai_loading",
        },
      ]);

      const reply = await sendChat({
        message: text,
        birthDate: birthFromPicker,
        history: [],
        clientFollowup: false,
        locale,
      });
      setMessages((prev) => {
        const rest = stripLoading(prev);
        const tail = rest[rest.length - 1];
        const head = rest.slice(0, -1);
        if (tail?.step === "local_result" && tail.payload) {
          const merged: ChatMessage = {
            role: "assistant",
            step: "combined_report",
            payload: tail.payload,
            content: reply.content,
            error: reply.error,
            modelWarning: reply.modelWarning,
            replySource: reply.replySource,
            generationMeta: reply.generationMeta,
          };
          return [...head, merged];
        }
        return [
          ...rest,
          {
            ...reply,
            payload: reply.payload ?? localPayload,
            step: "combined_report",
          },
        ];
      });
    } catch {
      setMessages((prev) => {
        const rest = stripLoading(prev);
        const tail = rest[rest.length - 1];
        const head = rest.slice(0, -1);
        if (tail?.step === "local_result" && tail.payload) {
          return [
            ...head,
            {
              role: "assistant",
              step: "combined_report",
              payload: tail.payload,
              content: "",
              error: t(locale, "networkError"),
            },
          ];
        }
        return [
          ...rest,
          {
            role: "assistant",
            content: "",
            error: t(locale, "networkError"),
            payload: localPayload,
          },
        ];
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>{t(locale, "headerTitle")}</h1>
            <p>{t(locale, "headerSubtitle")}</p>
          </div>
          <button
            type="button"
            className="app-lang-toggle"
            onClick={flipLocale}
            aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
          >
            {locale === "zh" ? t(locale, "langToEn") : t(locale, "langToZh")}
          </button>
        </div>
      </header>

      {backendBanner ? (
        <div className="note-muted" style={{ margin: "0 0 10px", flexShrink: 0 }}>
          {backendBanner}
        </div>
      ) : null}

      <div className="app-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={msg.role === "user" ? "app-msg-row user" : "app-msg-row"}
          >
            <div className={bubbleClass(msg)}>
              {msg.role === "assistant" && msg.loading ? (
                <p
                  className={
                    msg.step === "ai_loading"
                      ? "text-secondary ai-loading-breathe"
                      : "text-secondary"
                  }
                  style={{ margin: 0 }}
                >
                  {msg.content}
                </p>
              ) : null}
              {msg.role === "assistant" &&
              !msg.loading &&
              msg.error &&
              msg.step !== "combined_report" &&
              msg.step !== "followup_chat" ? (
                <p className="text-error">{msg.error}</p>
              ) : null}
              {msg.role === "assistant" && !msg.loading && msg.step === "local_result" && msg.payload ? (
                <>
                  <p className="reply-provenance">{t(locale, "replyProvenanceLocal")}</p>
                  <LogicSummary p={msg.payload} locale={locale} />
                  <details className="app-details full-ai-appendix" defaultOpen={false}>
                    <summary>{t(locale, "detailsAppendix")}</summary>
                    <div className="details-body">
                      <StructuredAppendix p={msg.payload} locale={locale} />
                    </div>
                  </details>
                  <p className="disclaimer">{msg.payload.disclaimer}</p>
                </>
              ) : null}
              {msg.role === "assistant" && !msg.loading && msg.step === "combined_report" && msg.payload ? (
                <>
                  {msg.error ? <p className="text-error">{msg.error}</p> : null}
                  <div className="result-section">
                    <div className="result-section-title">{t(locale, "summaryTitle")}</div>
                    <LogicSummary p={msg.payload} locale={locale} />
                  </div>
                  <div className="result-section">
                    <div className="result-section-title">{t(locale, "personalityTitle")}</div>
                    {msg.error && msg.payload.personality_synthesis ? (
                      <>
                        <p className="note-muted" style={{ margin: "0 0 10px", fontSize: "13px" }}>
                          {t(locale, "fallbackLocalNotePrefix")}
                          <strong>{t(locale, "fallbackLocalNoteStrong")}</strong>
                          {t(locale, "fallbackLocalNoteSuffix")}
                        </p>
                        <div className="report-flow">{msg.payload.personality_synthesis}</div>
                      </>
                    ) : null}
                    {!msg.error && msg.replySource !== "model" && String(msg.content ?? "").trim() ? (
                      <p className="note-muted" style={{ margin: "0 0 10px", fontSize: "13px" }}>
                        {t(locale, "replyMetaNote")}
                      </p>
                    ) : null}
                    {!msg.error && msg.modelWarning ? (
                      <p className="text-warn" style={{ marginTop: 0 }}>
                        {msg.modelWarning}
                      </p>
                    ) : null}
                    {!msg.error && msg.content ? (
                      <div className="report-flow">{msg.content}</div>
                    ) : null}
                    {!msg.error && !msg.content ? (
                      <p className="text-error" style={{ marginTop: 0 }}>
                        {t(locale, "noModelBody")}
                      </p>
                    ) : null}
                  </div>
                  <details
                    className="app-details full-ai-appendix"
                    defaultOpen={Boolean(msg.error || msg.modelWarning)}
                  >
                    <summary>{t(locale, "detailsAppendixOptional")}</summary>
                    <div className="details-body">
                      <StructuredAppendix
                        p={msg.payload}
                        locale={locale}
                        omitLogicSummary
                        omitPersonalitySynthesis={Boolean(
                          msg.error && msg.payload.personality_synthesis,
                        )}
                      />
                    </div>
                  </details>
                  <p className="disclaimer">{msg.payload.disclaimer}</p>
                </>
              ) : null}
              {msg.role === "assistant" && !msg.loading && msg.step === "followup_chat" && msg.payload ? (
                <>
                  {msg.error ? <p className="text-error">{msg.error}</p> : null}
                  <div className="result-section">
                    <div className="result-section-title">{t(locale, "followupTitle")}</div>
                    {!msg.error && msg.modelWarning ? (
                      <p className="text-warn" style={{ marginTop: 0 }}>
                        {msg.modelWarning}
                      </p>
                    ) : null}
                    {!msg.error && msg.content ? (
                      <div className="report-flow">{msg.content}</div>
                    ) : null}
                    {!msg.error && !msg.content ? (
                      <p className="text-error" style={{ marginTop: 0 }}>
                        {t(locale, "noModelBody")}
                      </p>
                    ) : null}
                  </div>
                  <details className="app-details full-ai-appendix" defaultOpen={false}>
                    <summary>{t(locale, "detailsAppendixCompare")}</summary>
                    <div className="details-body">
                      <LogicSummary p={msg.payload} locale={locale} />
                      <StructuredAppendix
                        p={msg.payload}
                        locale={locale}
                        omitLogicSummary
                        omitPersonalitySynthesis
                      />
                    </div>
                  </details>
                  <p className="disclaimer">{msg.payload.disclaimer}</p>
                </>
              ) : null}
              {msg.role === "assistant" && !msg.loading && !msg.payload && msg.content && (
                <div>{msg.content}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="app-footer" onSubmit={onSubmit}>
        <div className="app-controls">
          <LunarBirthField
            locale={locale}
            value={birthPicker}
            onChange={(iso) => {
              setBirthPicker(iso);
              setSubmitHint("");
            }}
          />
          <div className="app-compose">
            <input
              className="app-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSubmitHint("");
              }}
              placeholder={t(locale, "placeholderInput")}
              disabled={busy}
              enterKeyHint="send"
              autoComplete="off"
              inputMode="text"
            />
            <button type="submit" className="app-send" disabled={busy}>
              {busy ? t(locale, "sendBusy") : t(locale, "send")}
            </button>
          </div>
          {submitHint ? (
            <p className="text-warn" style={{ margin: "8px 0 0" }}>
              {submitHint}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
