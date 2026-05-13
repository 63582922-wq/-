import { useEffect, useMemo, useState } from "react";
import "./TriangleVisualizer.css";

type VisualPairDetail = {
  id: string;
  source_pair: string;
  source_digits: number[];
  result_digit: number;
  digit_labels: string[];
  traits: string[];
  in_chart: boolean;
  board_image: string;
  lines: string[];
  result_record?: {
    digit: number;
    labels: string[];
    lines: string[];
  };
  source_records?: Array<{
    digit: number;
    labels: string[];
    lines: string[];
  }>;
};

export type TriangleData = {
  boxes8: number[];
  pair_bottom: VisualPairDetail[];
  inner_bottom: VisualPairDetail[];
  inner_mid: VisualPairDetail[];
  inner_top: VisualPairDetail;
  outer_left: VisualPairDetail[];
  outer_right: VisualPairDetail[];
  top_cross: VisualPairDetail[];
  apex_outer: VisualPairDetail;
};

interface TriangleVisualizerProps {
  data: TriangleData | null;
  /** 用于底部「阳历」与年月日分栏，避免只看见归约数字却看不出原始日期 */
  birth?: { y: number; m: number; d: number } | null;
  locale?: "zh" | "en";
  mode?: "interactive" | "export";
}

const DELAY_MULTIPLIER = 0.5;

function compactLabels(labels?: string[]): string[] {
  if (!labels || labels.length === 0) return [];
  return labels
    .slice(0, 2)
    .map((label) => label.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);
}

function formatSourceEquation(detail?: VisualPairDetail) {
  if (!detail || !Array.isArray(detail.source_digits) || detail.source_digits.length < 2) {
    return "";
  }
  return `${detail.source_digits[0]} + ${detail.source_digits[1]}`;
}

function previewMeaning(detail?: VisualPairDetail, locale: "zh" | "en" = "zh") {
  if (!detail) return [];
  const labels = compactLabels(detail.digit_labels);
  if (labels.length > 0) {
    return labels;
  }
  if (detail.traits.length > 0) {
    return detail.traits.slice(0, 2);
  }
  if (detail.lines.length > 0) {
    return detail.lines.slice(0, 2);
  }
  return [locale === "zh" ? "暂无说明" : "No note"];
}

type NodeSpec = {
  key: string;
  pairText: string;
  value: number;
  detail?: VisualPairDetail;
  x: number;
  y: number;
  stage: number;
  kind?: "main" | "outer" | "base";
  compact?: boolean;
};

const VIEW_W = 1000;
const VIEW_H = 760;

export default function TriangleVisualizer({
  data,
  birth = null,
  locale = "zh",
  mode = "interactive",
}: TriangleVisualizerProps) {
  const interactive = mode === "interactive";
  const [activeHover, setActiveHover] = useState<
    | { nodeId: string; part: "result" | "a" | "b" }
    | null
  >(null);
  
  const safeData = useMemo(
    () => ({
      boxes8: Array.isArray(data?.boxes8) ? data!.boxes8 : [0, 0, 0, 0, 0, 0, 0, 0],
      pair_bottom: Array.isArray(data?.pair_bottom) ? data!.pair_bottom : [],
      inner_bottom: Array.isArray(data?.inner_bottom) ? data!.inner_bottom : [],
      inner_mid: Array.isArray(data?.inner_mid) ? data!.inner_mid : [],
      inner_top: data?.inner_top,
      outer_left: Array.isArray(data?.outer_left) ? data!.outer_left : [],
      outer_right: Array.isArray(data?.outer_right) ? data!.outer_right : [],
      top_cross: Array.isArray(data?.top_cross) ? data!.top_cross : [],
      apex_outer: data?.apex_outer,
    }),
    [data],
  );

  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!interactive) {
      setStage(4);
      return;
    }
    if (!data) {
      setStage(0);
      return;
    }
    setStage(0);
    const timers = [
      setTimeout(() => setStage(1), 100),
      setTimeout(() => setStage(2), 100 + 800 * DELAY_MULTIPLIER),
      setTimeout(() => setStage(3), 100 + 1600 * DELAY_MULTIPLIER),
      setTimeout(() => setStage(4), 100 + 2400 * DELAY_MULTIPLIER),
    ];
    return () => timers.forEach(clearTimeout);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setActiveHover(null);
      return;
    }
    setActiveHover(null);
  }, [data, interactive]);

  const {
    inner_bottom,
    inner_mid,
    inner_top,
    outer_left,
    outer_right,
    top_cross,
    apex_outer,
  } = safeData;

  const nodes = useMemo<NodeSpec[]>(
    () => [
      // 底层 4 个格子: y中心 = (483+650)/2 = 566.5
      // x中心: 左斜100, 竖线500, 右斜900
      // 内部由 233.6 到 766.4 (在 y=483 处) -> 越往下越宽
      // 直接计算底层四个矩形的几何中心:
      // ib0 x = (100+233.6+500+500)/4 => 取 260
      { key: "ib0", pairText: inner_bottom[0]?.source_pair ?? "", value: inner_bottom[0]?.result_digit ?? 0, detail: inner_bottom[0], x: 260, y: 566.5, stage: 1, kind: "main" },
      { key: "ib1", pairText: inner_bottom[1]?.source_pair ?? "", value: inner_bottom[1]?.result_digit ?? 0, detail: inner_bottom[1], x: 420, y: 566.5, stage: 1, kind: "main" },
      { key: "ib2", pairText: inner_bottom[2]?.source_pair ?? "", value: inner_bottom[2]?.result_digit ?? 0, detail: inner_bottom[2], x: 580, y: 566.5, stage: 1, kind: "main" },
      { key: "ib3", pairText: inner_bottom[3]?.source_pair ?? "", value: inner_bottom[3]?.result_digit ?? 0, detail: inner_bottom[3], x: 740, y: 566.5, stage: 1, kind: "main" },
      // 中层 2 个格子: y中心 = (316+483)/2 = 399.5
      { key: "ml", pairText: inner_mid[0]?.source_pair ?? "", value: inner_mid[0]?.result_digit ?? 0, detail: inner_mid[0], x: 380, y: 399.5, stage: 2, kind: "main" },
      { key: "mr", pairText: inner_mid[1]?.source_pair ?? "", value: inner_mid[1]?.result_digit ?? 0, detail: inner_mid[1], x: 620, y: 399.5, stage: 2, kind: "main" },
      // 顶层 1 个格子: y中心 = (150+316)/2 = 233
      { key: "top", pairText: inner_top?.source_pair ?? "", value: inner_top?.result_digit ?? 0, detail: inner_top, x: 500, y: 233, stage: 3, kind: "main" },
      
      // 外圈衍生结构（使用外侧最顶层的衍生结果作为代表）
      // 对外（左侧）
      { key: "ol", pairText: outer_left[2]?.source_pair ?? "", value: outer_left[2]?.result_digit ?? 0, detail: outer_left[2], x: 140, y: 316, stage: 4, kind: "outer" },
      // 对内（右侧）
      { key: "or", pairText: outer_right[2]?.source_pair ?? "", value: outer_right[2]?.result_digit ?? 0, detail: outer_right[2], x: 860, y: 316, stage: 4, kind: "outer" },
      // 对下（顶部）：逻辑修复，使用 apex_outer
      { key: "down", pairText: apex_outer?.source_pair ?? "", value: apex_outer?.result_digit ?? 0, detail: apex_outer, x: 500, y: 90, stage: 4, kind: "outer" },
    ],
    [inner_bottom, inner_mid, inner_top, outer_left, outer_right, apex_outer],
  );

  const nodeMap = useMemo(
    () =>
      Object.fromEntries(
        nodes
          .filter((node) => Boolean(node.detail))
          .map((node) => [node.key, node.detail as VisualPairDetail]),
      ),
    [nodes],
  );

  const activeDetail = activeHover ? nodeMap[activeHover.nodeId] : undefined;
  const activeMeaning = previewMeaning(activeDetail, locale);
  const activeEquation = activeDetail ? `${formatSourceEquation(activeDetail)} = ${activeDetail.result_digit}` : "";

  if (!data) {
    return (
      <div className="tv-container empty">
        <div className="tv-placeholder">
          <div className="tv-placeholder-icon" />
          <p>{locale === "zh" ? "等待输入出生日期" : "Waiting for birth date"}</p>
        </div>
      </div>
    );
  }

  const b8 = safeData.boxes8;
  const pairSourceLabel = locale === "en" ? "Source" : "来源";
  const shownStage = interactive ? stage : 4;

  return (
    <div className="tv-container">
      <div className="tv-layout">
        <div className="tv-aspect-ratio-box">
          
          {/* SVG 纯画骨架：大三角 + 内部一横一竖 */}
          <svg className="tv-svg-layer" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet">
            {/* 大三角形: 顶点(500,150) 底角(100,650) (900,650) 
                斜率k = (650-150)/(100-500) = 500/-400 = -1.25
                左斜边方程: y - 150 = -1.25(x - 500) => y = -1.25x + 775 => x = (775 - y) / 1.25
                右斜边方程: y - 150 = 1.25(x - 500) => y = 1.25x - 475 => x = (y + 475) / 1.25
            */}
            {shownStage >= 1 && <polygon points="500,150 100,650 900,650" className="tv-skeleton-line" />}
            
            {/* 中层横线: 设 y=483
                左端点 x = (775 - 483) / 1.25 = 292 / 1.25 = 233.6
                右端点 x = (483 + 475) / 1.25 = 958 / 1.25 = 766.4
            */}
            {shownStage >= 2 && <line x1="233.6" y1="483" x2="766.4" y2="483" className="tv-skeleton-line" />}
            
            {/* 顶层横线: 设 y=316
                左端点 x = (775 - 316) / 1.25 = 459 / 1.25 = 367.2
                右端点 x = (316 + 475) / 1.25 = 791 / 1.25 = 632.8
            */}
            {shownStage >= 3 && <line x1="367.2" y1="316" x2="632.8" y2="316" className="tv-skeleton-line" />}
            
            {/* 中间竖线 */}
            {shownStage >= 3 && <line x1="500" y1="316" x2="500" y2="650" className="tv-skeleton-line" />}
          </svg>

          {/* HTML 定位内容区 */}
          <div className="tv-content-layer">
            
            {/* 底部 8 个原始日期位 */}
            {shownStage >= 1 && (
              <div className="tv-base-row tv-fade-in">
                <div className="tv-base-group">
                  <div className="tv-base-digits">{`${b8[0] ?? ""}${b8[1] ?? ""}`}</div>
                  <div className="tv-base-label">{locale === "zh" ? "日期" : "Day"}</div>
                </div>
                <div className="tv-base-group">
                  <div className="tv-base-digits">{`${b8[2] ?? ""}${b8[3] ?? ""}`}</div>
                  <div className="tv-base-label">{locale === "zh" ? "月份" : "Month"}</div>
                </div>
                <div className="tv-base-group">
                  <div className="tv-base-digits">{`${b8[4] ?? ""}${b8[5] ?? ""}`}</div>
                  <div className="tv-base-label">{locale === "zh" ? "年份" : "Year"}</div>
                </div>
                <div className="tv-base-group">
                  <div className="tv-base-digits">{`${b8[6] ?? ""}${b8[7] ?? ""}`}</div>
                  <div className="tv-base-label">{locale === "zh" ? "年份" : "Year"}</div>
                </div>
              </div>
            )}

            {/* 三角形内部数字 */}
            {nodes.filter(n => n.kind === "main" && shownStage >= n.stage).map(node => (
              <div 
                key={node.key} 
                className={`tv-num-node tv-fade-in ${activeHover?.nodeId === node.key && activeHover.part === "result" ? "is-active" : ""}`}
                style={{ left: `${(node.x / VIEW_W) * 100}%`, top: `${(node.y / VIEW_H) * 100}%` }}
                onMouseEnter={interactive ? () => setActiveHover({ nodeId: node.key, part: "result" }) : undefined}
                onMouseLeave={interactive ? () => setActiveHover(null) : undefined}
              >
                {node.value}
              </div>
            ))}

            {/* 对外（左侧） */}
            {shownStage >= 4 && (
              <div 
                className="tv-outer-group tv-outer-left tv-fade-in"
                style={{ left: '16%', top: '41.5%' }}
              >
                <div className="tv-outer-title">对外</div>
                <div 
                  className="tv-fraction"
                  onMouseLeave={interactive ? () => setActiveHover(null) : undefined}
                >
                  <div
                    className={`tv-fraction-top ${activeHover?.nodeId === "ol" && activeHover.part === "result" ? "is-active" : ""}`}
                    onMouseEnter={interactive ? () => setActiveHover({ nodeId: "ol", part: "result" }) : undefined}
                  >
                    {nodes.find(n => n.key === "ol")?.value}
                  </div>
                  <div className="tv-fraction-bottom">
                    {(() => {
                      const pair = nodes.find(n => n.key === "ol")?.pairText ?? "";
                      if (pair.length !== 2) return pair;
                      const a = pair[0];
                      const b = pair[1];
                      return (
                        <>
                          <span
                            className={activeHover?.nodeId === "ol" && activeHover.part === "a" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "ol", part: "a" }) : undefined}
                          >
                            {a}
                          </span>
                          <span
                            className={activeHover?.nodeId === "ol" && activeHover.part === "b" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "ol", part: "b" }) : undefined}
                          >
                            {b}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* 对内（右侧） */}
            {shownStage >= 4 && (
              <div 
                className="tv-outer-group tv-outer-right tv-fade-in"
                style={{ left: '84%', top: '41.5%' }}
              >
                <div 
                  className="tv-fraction"
                  onMouseLeave={interactive ? () => setActiveHover(null) : undefined}
                >
                  <div
                    className={`tv-fraction-top ${activeHover?.nodeId === "or" && activeHover.part === "result" ? "is-active" : ""}`}
                    onMouseEnter={interactive ? () => setActiveHover({ nodeId: "or", part: "result" }) : undefined}
                  >
                    {nodes.find(n => n.key === "or")?.value}
                  </div>
                  <div className="tv-fraction-bottom">
                    {(() => {
                      const pair = nodes.find(n => n.key === "or")?.pairText ?? "";
                      if (pair.length !== 2) return pair;
                      const a = pair[0];
                      const b = pair[1];
                      return (
                        <>
                          <span
                            className={activeHover?.nodeId === "or" && activeHover.part === "a" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "or", part: "a" }) : undefined}
                          >
                            {a}
                          </span>
                          <span
                            className={activeHover?.nodeId === "or" && activeHover.part === "b" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "or", part: "b" }) : undefined}
                          >
                            {b}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="tv-outer-title">对内</div>
              </div>
            )}

            {/* 对下（顶部） */}
            {shownStage >= 4 && (
              <div 
                className="tv-outer-group tv-outer-top tv-fade-in"
                style={{ left: '50%', top: '4%' }}
              >
                <div className="tv-outer-title">对下</div>
                <div 
                  className="tv-fraction"
                  onMouseLeave={interactive ? () => setActiveHover(null) : undefined}
                >
                  <div
                    className={`tv-fraction-top ${activeHover?.nodeId === "down" && activeHover.part === "result" ? "is-active" : ""}`}
                    onMouseEnter={interactive ? () => setActiveHover({ nodeId: "down", part: "result" }) : undefined}
                  >
                    {nodes.find(n => n.key === "down")?.value}
                  </div>
                  <div className="tv-fraction-bottom">
                    {(() => {
                      const pair = nodes.find(n => n.key === "down")?.pairText ?? "";
                      if (pair.length !== 2) return pair;
                      const a = pair[0];
                      const b = pair[1];
                      return (
                        <>
                          <span
                            className={activeHover?.nodeId === "down" && activeHover.part === "a" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "down", part: "a" }) : undefined}
                          >
                            {a}
                          </span>
                          <span
                            className={activeHover?.nodeId === "down" && activeHover.part === "b" ? "is-active" : ""}
                            onMouseEnter={interactive ? () => setActiveHover({ nodeId: "down", part: "b" }) : undefined}
                          >
                            {b}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {interactive ? (
          <div className="tv-preview-card">
            {activeDetail ? (
              (() => {
                const which = activeHover?.part ?? "result";
                let detail: VisualPairDetail = activeDetail;
                if (which !== "result") {
                  if (activeHover?.nodeId === "ol") {
                    detail = outer_left[which === "a" ? 0 : 1] ?? activeDetail;
                  } else if (activeHover?.nodeId === "or") {
                    detail = outer_right[which === "a" ? 0 : 1] ?? activeDetail;
                  } else if (activeHover?.nodeId === "down") {
                    detail = top_cross[which === "a" ? 0 : 1] ?? activeDetail;
                  }
                }
                const record = detail.result_record;
                return (
                  <>
                    <div className="tv-preview-head">
                      <div className="tv-preview-badge">{detail.result_digit} 图</div>
                      <div className="tv-preview-pair">
                        {detail.source_pair} = {detail.result_digit}
                      </div>
                    </div>

                    <div className="tv-preview-core">
                      <span className="tv-preview-label">组合核心：</span>
                      {compactLabels(detail.digit_labels).join(" / ") || (detail.in_chart ? "" : "未单列")}
                    </div>

                    <div className="tv-preview-meaning">
                      <span className="tv-preview-label">组合含义：</span>
                    </div>
                    <ul className="tv-preview-traits">
                      {(detail.traits.length > 0 ? detail.traits : detail.lines)
                        .slice(0, 3)
                        .map((line, index) => (
                          <li key={`${detail.id}-${index}`}>{line}</li>
                        ))}
                    </ul>

                    {record ? (
                      <div className="tv-preview-single">
                        <div className="tv-preview-core" style={{ marginTop: "12px" }}>
                          <div style={{ marginBottom: "6px" }}>
                            <span className="tv-preview-label">来源算式：</span>
                            {formatSourceEquation(detail)} = {detail.result_digit}
                          </div>
                          <span className="tv-preview-label">单数字 {detail.result_digit} 核心：</span>
                          {(record.labels || []).join(" / ")}
                        </div>
                        <ul className="tv-preview-traits">
                          {(record.lines || []).slice(0, 4).map((line, index) => (
                            <li key={`res-${detail.id}-${index}`}>{line.replace(/^(阳面：|阴面：)/, "")}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                );
              })()
            ) : (
              <div className="tv-preview-empty">
                {locale === "zh"
                  ? "悬停任一数字，查看它由哪两个数字相加而来，以及对应含义。"
                  : "Hover any node to inspect its source pair and meaning."}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
