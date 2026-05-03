export type Locale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "xgbm_locale";

export function normalizeLocale(raw: string | null | undefined): Locale {
  const s = (raw ?? "").toLowerCase().trim();
  return s.startsWith("en") ? "en" : "zh";
}

const STRINGS = {
  zh: {
    headerTitle: "性格编码智能体",
    headerSubtitle: "生日推演 · 解读参考",
    langToEn: "English",
    langToZh: "中文",
    welcomeIntro:
      "你好。请先选择阴历生日并确认，或在右侧输入阳历日期（如 1994-01-15、1994/3/8），再点「发送」。\n\n"
      + "首次发送会先完成本地推算，再给出一段模型撰写的**个性简述**（散文体，非分条推演）。\n\n"
      + "测算完成后，只要继续在输入框里打字发送，即可**基于同一生日**与助手多轮追问；若要换生日，请在消息里写出新的阳历日期。\n\n"
      + "展开「讲义摘录与技术明细」可对照详情。内容为性格隐喻参考。",
    backendBanner404:
      "自检接口不可用（多为旧后端仍在占用端口）：请停掉旧进程后在仓库根目录启动 uvicorn，并 npm run build 后强刷页面。",
    backendBannerVersion: "后端与前端版本不一致：重启 uvicorn 并强刷页面即可。",
    submitHintNoBirth:
      "尚未识别到可用的阳历生日：请选择阴历并确认、在右侧输入阳历，或在完成一次测算后直接输入追问内容。",
    submitHintEmpty: "请输入要问的内容，或选择生日后发送。",
    loadingReply: "正在回复…",
    loadingLocal: "第一步：正在完成本地推算（三角形与融合码）…",
    loadingAi: "分析生成中。。。。",
    computeSolarPrefix: "请测算阳历生日",
    networkError: "网络不畅，请稍后重试。",
    serviceUnavailable: "服务暂时不可用，请稍后重试。",
    requestFailed: "请求失败",
    backendNoCompute:
      "后端仍是旧版本（没有 /api/compute）。请在仓库根目录重启 uvicorn，执行 npm run build 并强制刷新页面。",
    computeInvalidPayload: "本地推演返回数据异常。",
    modelFallbackWarning:
      "当前正文标记为本地整合（非模型全文）。若你期望走大模型，请升级后端并重启服务。",
    replyProvenanceLocal: "推算摘要（完成后会与模型解读合并为一条）",
    detailsRules: "规则说明与三角形数据",
    detailsAppendix: "讲义摘录与技术明细",
    detailsAppendixOptional: "讲义摘录与技术明细（可选）",
    detailsAppendixCompare: "讲义摘录与技术明细（对照）",
    summaryTitle: "推算摘要",
    personalityTitle: "个性简述",
    followupTitle: "追问回复",
    fallbackLocalNotePrefix: "本轮大模型未返回正文。以下为",
    fallbackLocalNoteStrong: "本地讲义整合",
    fallbackLocalNoteSuffix: "（模版拼装，仅供对照）。",
    replyMetaNote:
      "正文已显示；若缺少耗时与型号信息，多为后端未重启或仍在旧进程。",
    noModelBody: "未收到模型正文。请查看上方报错或下方讲义摘录。",
    logicSolar: "阳历",
    logicOuter: "外圈三组（对外 · 对内 · 对下）",
    logicInner: "内圈三组（左下 · 右下 · 顶点）",
    logicVertex: "三角形顶点底色",
    groupYang: "阳面：",
    groupYin: "阴面：",
    groupLink: "形质联结（",
    structuredTitle: "讲义摘录与技术明细，可与上文解读对照。",
    sectionInner: "内圈 · 融合码与讲义摘录",
    sectionOuter: "外圈 · 融合码与讲义摘录",
    digitLinePrefix: "顶点讲义 ·",
    personalityTemplateDetails: "讲义模版全文（对照）",
    placeholderInput: "生日或追问：19940308 / 内圈第三组是什么意思",
    send: "发送",
    sendBusy: "…",
    lunarTriggerEmpty: "点击选择阴历生日（将自动换算为公历用于测算）",
    lunarLineLunar: "阴历：",
    lunarLineSolar: "已换算公历：",
    sheetTitle: "选择阴历生日",
    sheetDesc: "上下滑动选择农历年、月、日。测算仍按对应公历推算。",
    colYear: "农历年",
    colMonth: "农历月",
    colDay: "农历日",
    previewLunar: "当前农历：",
    previewSolar: "对应公历：",
    previewInvalid: "当前组合无法换算，请稍调日期。",
    cancel: "取消",
    confirm: "确定 · 使用该公历测算",
    yearWheelSuffix: "年",
    dayWheelSuffix: "日",
  },
  en: {
    headerTitle: "Personality Encoding Agent",
    headerSubtitle: "Birth chart · interpretive reference",
    langToEn: "English",
    langToZh: "中文",
    welcomeIntro:
      "Hello. Pick a lunar birth date and confirm, or type a Gregorian date on the right (e.g. 1994-01-15, 1994/3/8), then tap **Send**.\n\n"
      + "The first run computes the chart locally, then adds a short **personality sketch** in prose (not a step-by-step derivation).\n\n"
      + "After that, keep typing in the same box for follow-up questions on the **same birth date**. To change the date, type a new Gregorian date in your message.\n\n"
      + "Open “Notes & technical detail” below to compare with the full excerpts. Content is metaphorical reference for self-reflection.",
    backendBanner404:
      "Health check unavailable (often an old server still on the port). Stop the old process, start uvicorn from the repo root, run npm run build, then hard-refresh.",
    backendBannerVersion: "Frontend and backend versions differ: restart uvicorn and hard-refresh.",
    submitHintNoBirth:
      "No usable Gregorian date yet: pick lunar and confirm, type a solar date on the right, or (after one successful run) type a follow-up question.",
    submitHintEmpty: "Type a question, or pick a birth date before sending.",
    loadingReply: "Replying…",
    loadingLocal: "Step 1: local chart (triangle & fusion codes)…",
    loadingAi: "Generating analysis…",
    computeSolarPrefix: "Compute solar birth",
    networkError: "Network error. Please try again later.",
    serviceUnavailable: "Service temporarily unavailable. Please try again later.",
    requestFailed: "Request failed",
    backendNoCompute:
      "Backend too old (no /api/compute). Restart uvicorn from repo root, npm run build, hard-refresh.",
    computeInvalidPayload: "Local compute returned invalid data.",
    modelFallbackWarning:
      "This text is from local template merge (not the full model output). Upgrade/restart the backend if you expect the LLM.",
    replyProvenanceLocal: "Chart summary (will merge with the model reply)",
    detailsRules: "Rules & triangle data",
    detailsAppendix: "Notes & technical detail",
    detailsAppendixOptional: "Notes & technical detail (optional)",
    detailsAppendixCompare: "Notes & technical detail (reference)",
    summaryTitle: "Chart summary",
    personalityTitle: "Personality sketch",
    followupTitle: "Follow-up",
    fallbackLocalNotePrefix: "The model returned no text this round. Below is ",
    fallbackLocalNoteStrong: "local template text",
    fallbackLocalNoteSuffix: " (assembled from notes, for comparison only).",
    replyMetaNote:
      "Body is shown; if timing/model info is missing, restart uvicorn or check for an old process.",
    noModelBody: "No model text received. Check errors above or the notes below.",
    logicSolar: "Gregorian",
    logicOuter: "Outer ring (outward · inward · downward)",
    logicInner: "Inner ring (lower-left · lower-right · apex)",
    logicVertex: "Triangle apex fill digit",
    groupYang: "Bright side: ",
    groupYin: "Shadow side: ",
    groupLink: "Form–substance link (",
    structuredTitle: "Notes & technical detail (compare with the sketch above).",
    sectionInner: "Inner ring · codes & excerpts",
    sectionOuter: "Outer ring · codes & excerpts",
    digitLinePrefix: "Apex note ·",
    personalityTemplateDetails: "Full template text (reference)",
    placeholderInput: "Birth or follow-up: 19940308 / what does inner ring 3 mean?",
    send: "Send",
    sendBusy: "…",
    lunarTriggerEmpty: "Tap to pick lunar birth (converted to Gregorian for the chart)",
    lunarLineLunar: "Lunar: ",
    lunarLineSolar: "Gregorian: ",
    sheetTitle: "Pick lunar birth date",
    sheetDesc: "Scroll to choose lunar year, month, and day. The chart uses the matching Gregorian date.",
    colYear: "Lunar year",
    colMonth: "Lunar month",
    colDay: "Lunar day",
    previewLunar: "Lunar: ",
    previewSolar: "Gregorian: ",
    previewInvalid: "This combination cannot be converted; adjust the date.",
    cancel: "Cancel",
    confirm: "OK · use this Gregorian date",
    yearWheelSuffix: "",
    dayWheelSuffix: "",
  },
} as const;

export type MsgKey = keyof typeof STRINGS.zh;

export function t(locale: Locale, key: MsgKey): string {
  const pack = STRINGS[locale];
  return (pack[key] as string) ?? (STRINGS.zh[key] as string);
}
