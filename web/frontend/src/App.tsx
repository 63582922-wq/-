import { FormEvent, useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
import { messageHasExtractableBirthDate } from "./date-parse";
import {
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
  t,
} from "./i18n";
import LunarBirthField from "./lunar-birth-field";
import type { TriangleData } from "./TriangleVisualizer";
import { SendHorizontal } from "lucide-react";

const TriangleVisualizer = lazy(() => import("./TriangleVisualizer"));

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
  visualization?: TriangleData;
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

const CASES_STORAGE_KEY = "xgbm_cases_v1";
const ACTIVE_CASE_STORAGE_KEY = "xgbm_active_case_v1";

type CaseSession = {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  hasStarted: boolean;
  messages: ChatMessage[];
  lockedBirthIso: string;
  birthPicker: string;
};

type CaseStore = {
  activeCaseId: string;
  cases: CaseSession[];
};

function formatBirthIso(b: { y: number; m: number; d: number }): string {
  return `${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")}`;
}

function genCaseId(): string {
  const g = typeof crypto !== "undefined" ? crypto : null;
  const uuid = g && typeof g.randomUUID === "function" ? g.randomUUID() : "";
  if (uuid) return uuid;
  return `case_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeWelcomeMessage(locale: Locale): ChatMessage {
  return { role: "assistant", content: t(locale, "welcomeIntro") };
}

function newCaseSession(locale: Locale): CaseSession {
  const now = Date.now();
  return {
    id: genCaseId(),
    createdAt: now,
    updatedAt: now,
    title: locale === "zh" ? "未命名案例" : "Untitled case",
    hasStarted: false,
    messages: [makeWelcomeMessage(locale)],
    lockedBirthIso: "",
    birthPicker: "",
  };
}

function normalizeLoadedCase(raw: unknown, locale: Locale): CaseSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : genCaseId();
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
  const updatedAt = typeof o.updatedAt === "number" ? o.updatedAt : createdAt;
  const title =
    typeof o.title === "string"
      ? o.title
      : locale === "zh"
        ? "未命名案例"
        : "Untitled case";
  const hasStarted = Boolean(o.hasStarted);
  const lockedBirthIso = typeof o.lockedBirthIso === "string" ? o.lockedBirthIso : "";
  const birthPicker = typeof o.birthPicker === "string" ? o.birthPicker : "";
  const messagesRaw = o.messages;
  const messages =
    Array.isArray(messagesRaw) && messagesRaw.length > 0
      ? (messagesRaw as ChatMessage[])
      : [makeWelcomeMessage(locale)];
  return {
    id,
    createdAt,
    updatedAt,
    title,
    hasStarted,
    messages,
    lockedBirthIso,
    birthPicker,
  };
}

function loadCaseStore(locale: Locale): CaseStore {
  if (typeof window === "undefined") {
    const c = newCaseSession(locale);
    return { activeCaseId: c.id, cases: [c] };
  }
  try {
    const raw = window.localStorage.getItem(CASES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const list = Array.isArray(parsed) ? parsed : [];
    const cases = list
      .map((x) => normalizeLoadedCase(x, locale))
      .filter(Boolean) as CaseSession[];
    const fallback = cases.length > 0 ? cases : [newCaseSession(locale)];
    const storedActive = window.localStorage.getItem(ACTIVE_CASE_STORAGE_KEY) ?? "";
    const activeCaseId =
      storedActive && fallback.some((c) => c.id === storedActive)
        ? storedActive
        : fallback[0].id;
    return { activeCaseId, cases: fallback };
  } catch {
    const c = newCaseSession(locale);
    return { activeCaseId: c.id, cases: [c] };
  }
}

function normalizeLoadedCaseStore(raw: unknown, locale: Locale): CaseStore | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const casesRaw = o.cases;
  const list = Array.isArray(casesRaw) ? casesRaw : [];
  const cases = list
    .map((x) => normalizeLoadedCase(x, locale))
    .filter(Boolean) as CaseSession[];
  if (cases.length === 0) return null;
  const activeRaw = o.activeCaseId;
  const activeCaseId =
    typeof activeRaw === "string" && cases.some((c) => c.id === activeRaw)
      ? activeRaw
      : cases[0].id;
  return { activeCaseId, cases };
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

function formatTs(ts: number, locale: Locale): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return locale === "zh" ? `${y}-${m}-${day} ${hh}:${mm}` : `${y}-${m}-${day} ${hh}:${mm}`;
  } catch {
    return "";
  }
}

function latestPayloadFromMessages(msgs: ChatMessage[]): AgentPayload | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].payload) return msgs[i].payload ?? null;
  }
  return null;
}

function latestAssistantBodyFromMessages(msgs: ChatMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    if (m.loading) continue;
    if (m.error) continue;
    if (!String(m.content ?? "").trim()) continue;
    if (m.step === "local_compute" || m.step === "local_result" || m.step === "ai_loading") continue;
    return m.content;
  }
  return "";
}

function ExportPage({
  caseSession,
  locale,
}: {
  caseSession: CaseSession;
  locale: Locale;
}) {
  const payload = useMemo(
    () => latestPayloadFromMessages(caseSession.messages),
    [caseSession.messages],
  );
  const assistantBody = useMemo(
    () => latestAssistantBodyFromMessages(caseSession.messages),
    [caseSession.messages],
  );

  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 450);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="export-shell">
      <div className="export-toolbar no-print">
        <div className="export-toolbar-title">
          {locale === "zh" ? "PDF 导出预览" : "PDF Export Preview"}
        </div>
        <div className="export-toolbar-actions">
          <button type="button" className="app-case-new" onClick={() => window.print()}>
            {locale === "zh" ? "打印/保存 PDF" : "Print/Save PDF"}
          </button>
          <button type="button" className="app-theme-toggle" onClick={() => window.close()}>
            {locale === "zh" ? "关闭" : "Close"}
          </button>
        </div>
      </div>

      <div className="export-page">
        <div className="export-header">
          <div className="export-title">
            {caseSession.title || (locale === "zh" ? "未命名案例" : "Untitled case")}
          </div>
          <div className="export-meta">
            <div>
              {locale === "zh" ? "创建：" : "Created: "}
              {formatTs(caseSession.createdAt, locale)}
            </div>
            <div>
              {locale === "zh" ? "更新：" : "Updated: "}
              {formatTs(caseSession.updatedAt, locale)}
            </div>
            <div>
              {locale === "zh" ? "锁定生日：" : "Birth locked: "}
              {caseSession.lockedBirthIso || "—"}
            </div>
          </div>
        </div>

        <div className="export-section">
          <div className="export-section-title">{locale === "zh" ? "图解" : "Diagram"}</div>
          <div className="export-diagram">
            <Suspense fallback={<div className="tv-suspense-fallback" />}>
              <TriangleVisualizer
                data={payload?.visualization ?? null}
                birth={payload?.birth ?? null}
                locale={locale}
                mode="export"
              />
            </Suspense>
          </div>
        </div>

        <div className="export-section">
          <div className="export-section-title">{locale === "zh" ? "逻辑结构" : "Logic"}</div>
          {payload ? (
            <div className="export-logic">
              <LogicSummary p={payload} locale={locale} />
              <div className="structured-appendix export-appendix">
                <div className="section-label">{locale === "zh" ? "外圈（对外/对内/对下）" : "Outer ring"}</div>
                {payload.fusion_groups.map((g) => (
                  <GroupCard key={`exp-out-${g.code + g.label}`} g={g} locale={locale} />
                ))}
                {payload.inner_fusion_groups && payload.inner_fusion_groups.length > 0 ? (
                  <>
                    <div className="section-label">{locale === "zh" ? "内圈（核心）" : "Inner ring"}</div>
                    {payload.inner_fusion_groups.map((g) => (
                      <GroupCard key={`exp-in-${g.code + g.label}`} g={g} locale={locale} />
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="note-muted">{locale === "zh" ? "暂无推演结果。" : "No payload."}</div>
          )}
        </div>

        <div className="export-section">
          <div className="export-section-title">{locale === "zh" ? "AI 输出" : "AI Output"}</div>
          {assistantBody ? (
            <div className="report-flow export-ai">{assistantBody}</div>
          ) : (
            <div className="note-muted">{locale === "zh" ? "暂无 AI 正文。" : "No AI body."}</div>
          )}
        </div>

        <div className="export-section">
          <div className="export-section-title">{locale === "zh" ? "对话记录" : "Chat Log"}</div>
          <div className="export-chat">
            {caseSession.messages.map((m, idx) => (
              <div key={idx} className={`export-chat-row ${m.role}`}>
                <div className="export-chat-role">{m.role === "user" ? (locale === "zh" ? "用户" : "User") : (locale === "zh" ? "AI" : "Assistant")}</div>
                <div className="export-chat-body report-flow">{String(m.content ?? "")}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const raw = window.localStorage.getItem("xgbm_theme");
    return raw === "light" ? "light" : "dark";
  });
  const [caseStore, setCaseStore] = useState<CaseStore>(() =>
    loadCaseStore(readStoredLocale()),
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitHint, setSubmitHint] = useState("");
  const [backendBanner, setBackendBanner] = useState<string | null>(null);
  const [cloudHint, setCloudHint] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);

  const isExport =
    typeof window !== "undefined" && window.location.pathname === "/export";

  const activeCase = useMemo(() => {
    const found = caseStore.cases.find((c) => c.id === caseStore.activeCaseId);
    return found ?? caseStore.cases[0];
  }, [caseStore]);

  const exportCaseId =
    isExport && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("caseId") ?? ""
      : "";
  const exportCase = useMemo(() => {
    if (!isExport) return activeCase;
    if (exportCaseId) {
      const found = caseStore.cases.find((c) => c.id === exportCaseId);
      if (found) return found;
    }
    return activeCase;
  }, [activeCase, caseStore.cases, exportCaseId, isExport]);

  const activeCaseRef = useRef<CaseSession>(activeCase);
  const activeCaseIdRef = useRef<string>(caseStore.activeCaseId);
  useEffect(() => {
    activeCaseRef.current = activeCase;
    activeCaseIdRef.current = caseStore.activeCaseId;
  }, [activeCase, caseStore.activeCaseId]);

  const hasStarted = activeCase.hasStarted;
  const messages = activeCase.messages;
  const lockedBirthIso = activeCase.lockedBirthIso;
  const birthPicker = activeCase.birthPicker;

  async function saveCaseStoreToServer() {
    setCloudBusy(true);
    setCloudHint("");
    try {
      const r = await fetch("/api/case-store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ store: caseStore }),
      });
      if (!r.ok) {
        setCloudHint(locale === "zh" ? "云保存失败" : "Cloud save failed");
        return;
      }
      setCloudHint(locale === "zh" ? "已保存到服务器" : "Saved to server");
    } catch {
      setCloudHint(locale === "zh" ? "云保存失败" : "Cloud save failed");
    } finally {
      setCloudBusy(false);
    }
  }

  async function loadCaseStoreFromServer() {
    setCloudBusy(true);
    setCloudHint("");
    try {
      const r = await fetch("/api/case-store", { cache: "no-store" });
      const j = (await r.json()) as { store?: unknown };
      const loaded = normalizeLoadedCaseStore(j.store, locale);
      if (!loaded) {
        setCloudHint(locale === "zh" ? "服务器暂无存档" : "No server snapshot");
        return;
      }
      setCaseStore(loaded);
      setCloudHint(locale === "zh" ? "已从服务器恢复" : "Restored from server");
    } catch {
      setCloudHint(locale === "zh" ? "云恢复失败" : "Cloud restore failed");
    } finally {
      setCloudBusy(false);
    }
  }

  function openPdfExport() {
    const id = caseStore.activeCaseId;
    const url = `/export?caseId=${encodeURIComponent(id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function updateCaseById(caseId: string, updater: (c: CaseSession) => CaseSession) {
    setCaseStore((prev) => {
      const nextCases = prev.cases.map((c) => {
        if (c.id !== caseId) return c;
        const next = updater(c);
        return { ...next, updatedAt: Date.now() };
      });
      return { ...prev, cases: nextCases };
    });
  }

  function updateActiveCase(updater: (c: CaseSession) => CaseSession) {
    const caseId = activeCaseIdRef.current;
    updateCaseById(caseId, updater);
  }

  function startNewCaseAndActivate(): string {
    const c = newCaseSession(locale);
    setCaseStore((prev) => ({
      activeCaseId: c.id,
      cases: [c, ...prev.cases],
    }));
    return c.id;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CASES_STORAGE_KEY, JSON.stringify(caseStore.cases));
      window.localStorage.setItem(ACTIVE_CASE_STORAGE_KEY, caseStore.activeCaseId);
    } catch {
      /* ignore */
    }
  }, [caseStore]);

  if (isExport) {
    return <ExportPage caseSession={exportCase} locale={locale} />;
  }

  // 引用最新成功的 payload 供左侧可视化使用
  const latestPayload = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].payload) {
        return messages[i].payload;
      }
    }
    return null;
  }, [messages]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (hasStarted) {
      scrollToBottom();
    }
  }, [messages, hasStarted]);

  function flipLocale() {
    const next: Locale = locale === "zh" ? "en" : "zh";
    setLocale(next);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    updateActiveCase((c) => {
      if (c.messages.length === 1 && c.messages[0].role === "assistant" && !c.messages[0].payload) {
        return { ...c, messages: [makeWelcomeMessage(next)] };
      }
      return c;
    });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("xgbm_theme", theme);
  }, [theme]);

  function flipTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
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
    const current = activeCaseRef.current;
    const iso = current.birthPicker.trim();
    const hasDateInMessage = messageHasExtractableBirthDate(text);
    const canResolveBirth =
      hasDateInMessage ||
      Boolean(iso) ||
      (Boolean(current.lockedBirthIso) && Boolean(text) && !hasDateInMessage);
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
    let targetCaseId = activeCaseIdRef.current;
    const needNewCase = Boolean(current.hasStarted && hasDateInMessage);
    if (needNewCase) {
      const c = newCaseSession(locale);
      const seeded: CaseSession = {
        ...c,
        hasStarted: true,
        messages: [
          ...c.messages,
          { role: "user", content: userLine },
          {
            role: "assistant",
            content: t(locale, "loadingLocal"),
            loading: true,
            step: "local_compute",
          },
        ],
      };
      targetCaseId = seeded.id;
      setCaseStore((prev) => ({
        activeCaseId: seeded.id,
        cases: [seeded, ...prev.cases],
      }));
    } else {
      updateCaseById(targetCaseId, (c) => ({ ...c, hasStarted: true }));
    }

    const birthFromPicker = hasDateInMessage
      ? ""
      : text
        ? current.lockedBirthIso || iso
        : iso;
    const followUpOnly =
      Boolean(current.lockedBirthIso) && Boolean(text) && !hasDateInMessage && !needNewCase;

    const historyForApi = needNewCase ? [] : buildApiHistory(current.messages);

    const stripLoading = (prev: ChatMessage[]) =>
      prev.filter((m) => !(m.role === "assistant" && m.loading));

    if (followUpOnly) {
      updateCaseById(targetCaseId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          { role: "user", content: userLine },
          {
            role: "assistant",
            content: t(locale, "loadingReply"),
            loading: true,
            step: "ai_loading",
          },
        ],
      }));
      setInput("");
      setBusy(true);
      try {
        const first = await fetchLocalPayload(text, current.lockedBirthIso, locale);
        if (!first.ok) {
          updateCaseById(targetCaseId, (c) => ({
            ...c,
            messages: [
              ...stripLoading(c.messages),
              { role: "assistant", content: "", error: first.error },
            ],
          }));
          return;
        }
        const birthThisRound = formatBirthIso(first.payload.birth);
        updateCaseById(targetCaseId, (c) => ({
          ...c,
          lockedBirthIso: birthThisRound,
          title: birthThisRound,
        }));
        const reply = await sendChat({
          message: text,
          birthDate: birthThisRound,
          history: historyForApi,
          clientFollowup: true,
          locale,
        });
        updateCaseById(targetCaseId, (c) => ({
          ...c,
          messages: [
            ...stripLoading(c.messages),
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
          ],
        }));
      } catch {
        updateCaseById(targetCaseId, (c) => ({
          ...c,
          messages: [
            ...stripLoading(c.messages),
            {
              role: "assistant",
              content: "",
              error: t(locale, "networkError"),
            },
          ],
        }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!needNewCase) {
      updateCaseById(targetCaseId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          { role: "user", content: userLine },
          {
            role: "assistant",
            content: t(locale, "loadingLocal"),
            loading: true,
            step: "local_compute",
          },
        ],
      }));
    }
    setInput("");
    setBusy(true);
    let localPayload: AgentPayload | undefined;

    try {
      const first = await fetchLocalPayload(text, birthFromPicker, locale);
      if (!first.ok) {
        updateCaseById(targetCaseId, (c) => ({
          ...c,
          messages: [
            ...stripLoading(c.messages),
            { role: "assistant", content: "", error: first.error },
          ],
        }));
        return;
      }
      localPayload = first.payload;
      const locked = formatBirthIso(first.payload.birth);
      updateCaseById(targetCaseId, (c) => ({
        ...c,
        lockedBirthIso: locked,
        title: locked,
        birthPicker: "",
        messages: [
          ...stripLoading(c.messages),
          {
            role: "assistant",
            payload: first.payload,
            content: "",
            step: "local_result",
          },
          {
            role: "assistant",
            content: t(locale, "loadingAi"),
            loading: true,
            step: "ai_loading",
          },
        ],
      }));

      const reply = await sendChat({
        message: text,
        birthDate: birthFromPicker,
        history: [],
        clientFollowup: false,
        locale,
      });
      updateCaseById(targetCaseId, (c) => {
        const rest = stripLoading(c.messages);
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
          return { ...c, messages: [...head, merged] };
        }
        return {
          ...c,
          messages: [
            ...rest,
            {
              ...reply,
              payload: reply.payload ?? localPayload,
              step: "combined_report",
            },
          ],
        };
      });
    } catch {
      updateCaseById(targetCaseId, (c) => {
        const rest = stripLoading(c.messages);
        const tail = rest[rest.length - 1];
        const head = rest.slice(0, -1);
        if (tail?.step === "local_result" && tail.payload) {
          return {
            ...c,
            messages: [
              ...head,
              {
                role: "assistant",
                step: "combined_report",
                payload: tail.payload,
                content: "",
                error: t(locale, "networkError"),
              },
            ],
          };
        }
        return {
          ...c,
          messages: [
            ...rest,
            {
              role: "assistant",
              content: "",
              error: t(locale, "networkError"),
              payload: localPayload,
            },
          ],
        };
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`app-shell ${hasStarted ? "app-started" : "app-landing"}`}>
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>{t(locale, "headerTitle")}</h1>
            <p>{t(locale, "headerSubtitle")}</p>
          </div>
          <div className="app-header-actions">
            <select
              className="app-case-select"
              value={caseStore.activeCaseId}
              onChange={(e) => {
                const id = e.target.value;
                setCaseStore((prev) => ({ ...prev, activeCaseId: id }));
                setSubmitHint("");
              }}
              aria-label={locale === "zh" ? "切换案例" : "Switch case"}
            >
              {caseStore.cases
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || (locale === "zh" ? "未命名案例" : "Untitled case")}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="app-case-new"
              onClick={() => {
                startNewCaseAndActivate();
                setInput("");
                setSubmitHint("");
              }}
            >
              {locale === "zh" ? "新案例" : "New"}
            </button>
            <button
              type="button"
              className="app-case-new"
              onClick={saveCaseStoreToServer}
              disabled={cloudBusy}
            >
              {locale === "zh" ? "云保存" : "Save"}
            </button>
            <button
              type="button"
              className="app-case-new"
              onClick={loadCaseStoreFromServer}
              disabled={cloudBusy}
            >
              {locale === "zh" ? "云恢复" : "Restore"}
            </button>
            <button
              type="button"
              className="app-case-new"
              onClick={openPdfExport}
            >
              {locale === "zh" ? "下载PDF" : "PDF"}
            </button>
            <button
              type="button"
              className="app-theme-toggle"
              onClick={flipTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "切换到夜间模式"}
            >
              {theme === "dark" ? (locale === "zh" ? "日间" : "Light") : (locale === "zh" ? "夜间" : "Dark")}
            </button>
            <button
              type="button"
              className="app-lang-toggle"
              onClick={flipLocale}
              aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
            >
              {locale === "zh" ? t(locale, "langToEn") : t(locale, "langToZh")}
            </button>
          </div>
        </div>
      </header>

      {backendBanner ? (
        <div className="note-muted" style={{ margin: "0 0 10px", flexShrink: 0 }}>
          {backendBanner}
        </div>
      ) : null}
      {cloudHint ? (
        <div className="note-muted" style={{ margin: "0 0 10px", flexShrink: 0 }}>
          {cloudHint}
        </div>
      ) : null}

      {!hasStarted ? (
        // === 首页模式 (Landing) ===
        <div className="landing-container">
          <div className="landing-content">
            <h2 className="landing-hero-title">
              {locale === "zh" ? "探索性格的隐喻编码" : "Explore Personality Metaphors"}
            </h2>
            <p className="landing-hero-subtitle">
              {locale === "zh" 
                ? "基于出生日期与三角形九进制算法的深度洞察" 
                : "Deep insights based on birth date and base-9 triangle algorithm"}
            </p>
            <form className="landing-form" onSubmit={onSubmit}>
              <div className="landing-inputs">
                <LunarBirthField
                  locale={locale}
                  value={birthPicker}
                  onChange={(iso) => {
                    updateActiveCase((c) => ({ ...c, birthPicker: iso }));
                    setSubmitHint("");
                  }}
                />
                <input
                  className="app-input landing-input"
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
              </div>
              <button type="submit" className="landing-submit" disabled={busy}>
                {busy ? t(locale, "sendBusy") : t(locale, "send")}
              </button>
              {submitHint && (
                <p className="text-warn text-center" style={{ marginTop: "12px" }}>
                  {submitHint}
                </p>
              )}
            </form>
          </div>
        </div>
      ) : (
        // === 结果页模式 (Dashboard: 左右分栏) ===
        <div className="dashboard-container">
          {/* 左侧可视化区 */}
          <div className="dashboard-left">
            <Suspense fallback={<div className="tv-suspense-fallback" />}>
              <TriangleVisualizer
                data={latestPayload?.visualization ?? null}
                birth={latestPayload?.birth ?? null}
                locale={locale}
              />
            </Suspense>
          </div>

          {/* 右侧对话与结果区 */}
          <div className="dashboard-right">
            <div className="app-messages" role="log" aria-live="polite">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={msg.role === "user" ? "app-msg-row user" : "app-msg-row"}
                >
                  <div className={bubbleClass(msg)}>
                    {msg.role === "user" ? (
                      <p className="app-bubble-user-plain" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {msg.content}
                      </p>
                    ) : null}
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
                    {/* 本地结果临时气泡 */}
                    {msg.role === "assistant" && !msg.loading && msg.step === "local_result" && msg.payload ? (
                      <>
                        <p className="reply-provenance">{t(locale, "replyProvenanceLocal")}</p>
                        <p className="note-muted" style={{ margin: "10px 0" }}>
                          {locale === "zh" ? "正在推演中..." : "Computing..."}
                        </p>
                      </>
                    ) : null}
                    {/* 完整报告 */}
                    {msg.role === "assistant" && !msg.loading && msg.step === "combined_report" && msg.payload ? (
                      <>
                        {msg.error ? <p className="text-error">{msg.error}</p> : null}
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
                              omitLogicSummary={false}
                              omitPersonalitySynthesis={Boolean(
                                msg.error && msg.payload.personality_synthesis,
                              )}
                            />
                          </div>
                        </details>
                        <p className="disclaimer">{msg.payload.disclaimer}</p>
                      </>
                    ) : null}
                    {/* 追问回复 */}
                    {msg.role === "assistant" && !msg.loading && msg.step === "followup_chat" && msg.payload ? (
                      <>
                        {msg.error ? <p className="text-error">{msg.error}</p> : null}
                        <div className="result-section">
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
                      </>
                    ) : null}
                    {msg.role === "assistant" && !msg.loading && !msg.payload && msg.content && (
                      <div>{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <form className="dashboard-footer" onSubmit={onSubmit}>
              <div className="app-compose">
                <input
                  className="app-input"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setSubmitHint("");
                  }}
                  placeholder={locale === "zh" ? "继续追问或输入新日期..." : "Follow up or enter new date..."}
                  disabled={busy}
                  enterKeyHint="send"
                  autoComplete="off"
                  inputMode="text"
                />
                <button type="submit" className="app-send-icon-btn" disabled={busy || !input.trim()}>
                  <SendHorizontal size={20} />
                </button>
              </div>
              {submitHint ? (
                <p className="text-warn" style={{ margin: "8px 0 0" }}>
                  {submitHint}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
