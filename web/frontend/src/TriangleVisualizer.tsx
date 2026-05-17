import { useEffect, useMemo, useState } from "react";
import {
  toggleTriangleSelection,
  type TriangleNodePart,
  type TriangleNodeSelection,
} from "./triangle-selection";
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
    卦象节气时辰?: string;
    核心物理属性?: string;
    阳面?: string[];
    阴面?: string[];
  };
  source_records?: Array<{
    digit: number;
    卦象节气时辰?: string;
    核心物理属性?: string;
    阳面?: string[];
    阴面?: string[];
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
  /** 受控选中（点击固定；再点同一格取消） */
  selection?: TriangleNodeSelection | null;
  onSelectionChange?: (sel: TriangleNodeSelection | null) => void;
}

const DELAY_MULTIPLIER = 0.5;

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
  locale = "zh",
  mode = "interactive",
  selection = null,
  onSelectionChange,
}: TriangleVisualizerProps) {
  const interactive = mode === "interactive";

  const pick = (nodeId: string, part: TriangleNodePart) => {
    if (!interactive || !onSelectionChange) return;
    onSelectionChange(toggleTriangleSelection(selection, { nodeId, part }));
  };

  const isActive = (nodeId: string, part: TriangleNodePart) =>
    selection?.nodeId === nodeId && selection?.part === part;

  const renderFractionPair = (
    nodeId: "ol" | "or" | "down",
    value: number,
    pairText: string,
  ) => (
    <div className="tv-fraction">
      <div
        className={`tv-fraction-top ${isActive(nodeId, "result") ? "is-active" : ""}${interactive ? " is-clickable" : ""}`}
        onClick={interactive ? () => pick(nodeId, "result") : undefined}
      >
        {value}
      </div>
      <div className="tv-fraction-bottom">
        {pairText.length === 2 ? (
          <>
            <span
              className={`${isActive(nodeId, "a") ? "is-active" : ""}${interactive ? " is-clickable" : ""}`}
              onClick={interactive ? () => pick(nodeId, "a") : undefined}
            >
              {pairText[0]}
            </span>
            <span
              className={`${isActive(nodeId, "b") ? "is-active" : ""}${interactive ? " is-clickable" : ""}`}
              onClick={interactive ? () => pick(nodeId, "b") : undefined}
            >
              {pairText[1]}
            </span>
          </>
        ) : (
          pairText
        )}
      </div>
    </div>
  );

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
                className={`tv-num-node tv-fade-in ${isActive(node.key, "result") ? "is-active" : ""}${interactive ? " is-clickable" : ""}`}
                style={{ left: `${(node.x / VIEW_W) * 100}%`, top: `${(node.y / VIEW_H) * 100}%` }}
                onClick={interactive ? () => pick(node.key, "result") : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pick(node.key, "result");
                        }
                      }
                    : undefined
                }
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
              >
                {node.value}
              </div>
            ))}

            {/* 对外（左侧） */}
            {shownStage >= 4 && (
              <div
                className="tv-outer-group tv-outer-left tv-fade-in"
                style={{ left: "16%", top: "41.5%" }}
              >
                <div className="tv-outer-title">对外</div>
                {renderFractionPair(
                  "ol",
                  nodes.find((n) => n.key === "ol")?.value ?? 0,
                  nodes.find((n) => n.key === "ol")?.pairText ?? "",
                )}
              </div>
            )}

            {/* 对内（右侧） */}
            {shownStage >= 4 && (
              <div
                className="tv-outer-group tv-outer-right tv-fade-in"
                style={{ left: "84%", top: "41.5%" }}
              >
                {renderFractionPair(
                  "or",
                  nodes.find((n) => n.key === "or")?.value ?? 0,
                  nodes.find((n) => n.key === "or")?.pairText ?? "",
                )}
                <div className="tv-outer-title">对内</div>
              </div>
            )}

            {/* 对下（顶部） */}
            {shownStage >= 4 && (
              <div
                className="tv-outer-group tv-outer-top tv-fade-in"
                style={{ left: "50%", top: "4%" }}
              >
                <div className="tv-outer-title">对下</div>
                {renderFractionPair(
                  "down",
                  nodes.find((n) => n.key === "down")?.value ?? 0,
                  nodes.find((n) => n.key === "down")?.pairText ?? "",
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
