import { FormEvent, useEffect, useMemo, useState } from "react";
import LunarBirthField from "./lunar-birth-field";

/** 须与 web/backend/main.py 中 API_BUILD_MARK 保持一致 */
const EXPECTED_API_BUILD_MARK = "reply-source-v6";

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
    | "combined_report";
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

async function fetchLocalPayload(
  message: string,
  birthDate: string,
): Promise<{ ok: true; payload: AgentPayload } | { ok: false; error: string }> {
  const res = await fetch("/api/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      message,
      birth_date: birthDate.trim() || null,
    }),
  });
  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "服务暂时不可用，请稍后重试。" };
  }
  if (res.status === 404) {
    return {
      ok: false,
      error:
        "后端仍是旧版本（没有 /api/compute）。请在仓库根目录重启 uvicorn，执行 npm run build 并强制刷新页面。",
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
    return { ok: false, error: msg || `请求失败（HTTP ${res.status}）` };
  }
  const payload = data.payload as AgentPayload | undefined;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "本地推演返回数据异常。" };
  }
  return { ok: true, payload };
}

async function sendChat(message: string, birthDate: string): Promise<ChatMessage> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      message,
      birth_date: birthDate.trim() || null,
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
      error: "服务暂时不可用，请稍后重试。",
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
      error: msg || `请求失败（HTTP ${res.status}）`,
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
    rs === "fallback"
      ? "当前正文标记为本地整合（非模型全文）。若你期望走大模型，请升级后端并重启服务。"
      : undefined;

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

function GroupCard({ g }: { g: FusionGroup }) {
  return (
    <article className="card-group">
      <header>
        {g.label} · <code>{g.code}</code>
      </header>
      <p style={{ margin: "0 0 8px" }}>
        形（首位 {g.形.digit}）：{g.形.卦象节气时辰}
      </p>
      <ul>
        <li>阳面：{g.形.阳面.join("；")}</li>
        <li>阴面：{g.形.阴面.join("；")}</li>
      </ul>
      <p style={{ margin: "12px 0 6px", fontWeight: 600, color: "var(--text)" }}>
        质（后两位 {g.质_后两位.pair} → 根 {g.质_后两位.root}）
      </p>
      <ul>
        {g.质_后两位.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {g.形质联结 && (
        <>
          <p style={{ margin: "12px 0 6px", fontWeight: 600, color: "var(--text)" }}>
            形质联结（{g.形质联结.pair}）
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

function LogicSummary({ p }: { p: AgentPayload }) {
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
        阳历 <code>{iso}</code>
      </div>
      <div className="logic-summary-row">
        外圈三组（对外 · 对内 · 对下） <code>{outer}</code>
      </div>
      <div className="logic-summary-row">
        内圈三组（左下 · 右下 · 顶点） <code>{inner}</code>
      </div>
      <div className="logic-summary-row">
        三角形顶点底色 <code>{String(p.inner_top_digit.digit)}</code>
      </div>
    </div>
  );
}

/** 推演明细与讲义原文，可与上文解读对照。 */
function StructuredAppendix({
  p,
  omitPersonalitySynthesis,
  omitLogicSummary,
}: {
  p: AgentPayload;
  omitPersonalitySynthesis?: boolean;
  omitLogicSummary?: boolean;
}) {
  return (
    <div className="structured-appendix">
      {!omitLogicSummary ? <LogicSummary p={p} /> : null}
      <details className="app-details">
        <summary>规则说明与三角形数据</summary>
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
        顶点讲义 · {p.inner_top_digit.digit} · {p.inner_top_digit.卦象节气时辰}
      </p>
      {p.interpretation_frame && (
        <div className="note-muted">{p.interpretation_frame}</div>
      )}
      {p.inner_fusion_groups && p.inner_fusion_groups.length > 0 && (
        <>
          <div className="section-label">内圈 · 融合码与讲义摘录</div>
          {p.inner_fusion_groups.map((g) => (
            <GroupCard key={`in-${g.code + g.label}`} g={g} />
          ))}
        </>
      )}
      <div className="section-label">外圈 · 融合码与讲义摘录</div>
      {p.fusion_groups.map((g) => (
        <GroupCard key={g.code + g.label} g={g} />
      ))}
      {p.personality_synthesis && !omitPersonalitySynthesis ? (
        <details className="app-details" style={{ marginTop: 12 }}>
          <summary>讲义模版全文（对照）</summary>
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
  if (msg.role === "assistant" && msg.payload) return `${base} app-bubble--result`;
  return base;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "你好。请先选择阴历生日并确认，或在右侧输入阳历日期（如 1994-01-15、1994/3/8），再点「发送」。\n\n"
        + "发送后会在同一条回复里先后完成：先显示推算摘要，再在同一气泡内接上模型解读（中间可能有十余秒等待）。\n\n"
        + "底部一处「讲义摘录与技术明细」可展开查看详情。内容为性格隐喻参考，非心理咨询诊断。",
    },
  ]);
  const [input, setInput] = useState("");
  const [birthPicker, setBirthPicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitHint, setSubmitHint] = useState("");
  const [backendBanner, setBackendBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        if (cancelled) return;
        if (r.status === 404) {
          setBackendBanner(
            "自检接口不可用（多为旧后端仍在占用端口）：请停掉旧进程后在仓库根目录启动 uvicorn，并 npm run build 后强刷页面。",
          );
          return;
        }
        if (!r.ok) return;
        const j = (await r.json()) as { build_mark?: string };
        if (j.build_mark !== EXPECTED_API_BUILD_MARK) {
          setBackendBanner("后端与前端版本不一致：重启 uvicorn 并强刷页面即可。");
        }
      } catch {
        /* 未启动后端或纯静态预览 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    const iso = birthPicker.trim();
    if (!text && !iso) {
      setSubmitHint(
        "尚未填写生日：请先点上方选择阴历并确认，或在右侧输入阳历日期后再点发送。",
      );
      return;
    }
    setSubmitHint("");
    const userLine = text || (iso ? `请测算阳历生日 ${iso}` : "");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userLine },
      {
        role: "assistant",
        content: "第一步：正在完成本地推算（三角形与融合码）…",
        loading: true,
        step: "local_compute",
      },
    ]);
    setInput("");
    setBusy(true);
    let localPayload: AgentPayload | undefined;
    const stripLoading = (prev: ChatMessage[]) =>
      prev.filter((m) => !(m.role === "assistant" && m.loading));

    try {
      const first = await fetchLocalPayload(text, iso);
      if (!first.ok) {
        setMessages((prev) => [
          ...stripLoading(prev),
          { role: "assistant", content: "", error: first.error },
        ]);
        return;
      }
      localPayload = first.payload;
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
          content:
            "分析生成中。。。。",
          loading: true,
          step: "ai_loading",
        },
      ]);

      const reply = await sendChat(text, iso);
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
              error: "网络不畅，请稍后重试。",
            },
          ];
        }
        return [
          ...rest,
          {
            role: "assistant",
            content: "",
            error: "网络不畅，请稍后重试。",
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
        <h1>性格编码智能体</h1>
        <p>生日推演 · 解读参考 · 非临床诊断</p>
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
              {msg.role === "assistant" && !msg.loading && msg.error && msg.step !== "combined_report" ? (
                <p className="text-error">{msg.error}</p>
              ) : null}
              {msg.role === "assistant" && !msg.loading && msg.step === "local_result" && msg.payload ? (
                <>
                  <p className="reply-provenance">推算摘要（完成后会与模型解读合并为一条）</p>
                  <LogicSummary p={msg.payload} />
                  <details className="app-details full-ai-appendix" defaultOpen={false}>
                    <summary>讲义摘录与技术明细</summary>
                    <div className="details-body">
                      <StructuredAppendix p={msg.payload} />
                    </div>
                  </details>
                  <p className="disclaimer">{msg.payload.disclaimer}</p>
                </>
              ) : null}
              {msg.role === "assistant" && !msg.loading && msg.step === "combined_report" && msg.payload ? (
                <>
                  {msg.error ? <p className="text-error">{msg.error}</p> : null}
                  <div className="result-section">
                    <div className="result-section-title">推算摘要</div>
                    <LogicSummary p={msg.payload} />
                  </div>
                  <div className="result-section">
                    <div className="result-section-title">性格分析（大模型）</div>
                    {msg.error && msg.payload.personality_synthesis ? (
                      <>
                        <p className="note-muted" style={{ margin: "0 0 10px", fontSize: "13px" }}>
                          本轮大模型未返回正文。以下为<strong>本地讲义整合</strong>（模版拼装，仅供对照）。
                        </p>
                        <div className="report-flow">{msg.payload.personality_synthesis}</div>
                      </>
                    ) : null}
                    {!msg.error && msg.replySource === "model" && msg.generationMeta ? (
                      <p className="generation-meta">
                        模型已响应 · 约 {msg.generationMeta.elapsed_seconds} 秒 ·{" "}
                        {msg.generationMeta.model} · {msg.generationMeta.api_host}
                      </p>
                    ) : null}
                    {!msg.error && msg.replySource !== "model" && String(msg.content ?? "").trim() ? (
                      <p className="note-muted" style={{ margin: "0 0 10px", fontSize: "13px" }}>
                        正文已显示；若缺少耗时与型号信息，多为后端未重启或仍在旧进程。
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
                        未收到模型正文。请查看上方报错或下方讲义摘录。
                      </p>
                    ) : null}
                  </div>
                  <details
                    className="app-details full-ai-appendix"
                    defaultOpen={Boolean(msg.error || msg.modelWarning)}
                  >
                    <summary>讲义摘录与技术明细（可选）</summary>
                    <div className="details-body">
                      <StructuredAppendix
                        p={msg.payload}
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
              placeholder="阳历：1994-01-15 / 1994/3/8 / 19940308 / 1994年1月15日"
              disabled={busy}
              enterKeyHint="send"
              autoComplete="off"
              inputMode="text"
            />
            <button type="submit" className="app-send" disabled={busy}>
              {busy ? "…" : "发送"}
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
