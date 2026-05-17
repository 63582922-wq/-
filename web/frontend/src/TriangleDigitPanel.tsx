import type { TriangleData } from "./TriangleVisualizer";
import {
  FUSION_ENCODE_SCHEMA_VERSION,
  labelDigitCore,
  labelFormHeading,
  labelSubstanceHeading,
  labelTraitsHeading,
  panelEmptyHint,
  schemaStaleHint,
} from "./fusion-terms";
import {
  boardFeatureText,
  clickedDigitHint,
  type DigitLecture,
  formatDigitCoreProse,
  fusionFromDetail,
  hasDigitCoreContent,
  nodePositionLabel,
  resolveSelectionDetail,
  type TriangleNodeSelection,
} from "./triangle-selection";

function DigitCoreBody({
  block,
  digit,
  locale,
}: {
  block: DigitLecture | undefined;
  digit: number;
  locale: "zh" | "en";
}) {
  if (!hasDigitCoreContent(block)) {
    return (
      <p className="tv-digit-panel-muted">
        {digit === 0
          ? locale === "zh"
            ? "（0 为日期占位位，不参与九图单数字讲义。）"
            : "(0 is a date placeholder, not in the 1–9 lecture.)"
          : locale === "zh"
            ? `（暂无数字 ${digit} 的讲义条目）`
            : `(No lecture entry for digit ${digit}.)`}
      </p>
    );
  }
  return (
    <p className="tv-digit-panel-line tv-digit-core-prose">{formatDigitCoreProse(block)}</p>
  );
}

type Props = {
  data: TriangleData | null;
  digitLexicon: Map<number, DigitLecture>;
  encodeSchemaVersion?: number;
  selection: TriangleNodeSelection | null;
  locale: "zh" | "en";
  onClear: () => void;
};

export default function TriangleDigitPanel({
  data,
  digitLexicon,
  encodeSchemaVersion,
  selection,
  locale,
  onClear,
}: Props) {
  const schemaStale =
    encodeSchemaVersion !== undefined &&
    encodeSchemaVersion < FUSION_ENCODE_SCHEMA_VERSION;
  const detail =
    data && selection ? resolveSelectionDetail(data, selection) : null;
  const fusion = detail ? fusionFromDetail(detail, digitLexicon) : null;

  return (
    <aside className="tv-digit-panel" aria-label={locale === "zh" ? "数字含义" : "Digit meaning"}>
      <div className="tv-digit-panel-head">
        <h2 className="tv-digit-panel-title">
          {locale === "zh" ? "数字看板" : "Digit board"}
        </h2>
        {selection ? (
          <button type="button" className="tv-digit-panel-clear" onClick={onClear}>
            {locale === "zh" ? "清除" : "Clear"}
          </button>
        ) : null}
      </div>
      <div className="tv-digit-panel-body">
        {schemaStale ? (
          <p className="tv-digit-panel-muted">{schemaStaleHint(locale)}</p>
        ) : null}
        {!fusion || !selection || !detail ? (
          <p className="tv-digit-panel-empty">{panelEmptyHint(locale)}</p>
        ) : (
          <>
            <p className="tv-digit-panel-context">
              {nodePositionLabel(selection.nodeId, locale, selection.part)}
              {" · "}
              {fusion.code}
            </p>
            <p className="tv-digit-panel-click-hint">
              {clickedDigitHint(selection, fusion, locale)}
            </p>

            <p className="tv-digit-panel-section-title">
              {labelSubstanceHeading(fusion.zhiA, fusion.zhiB, locale)}
            </p>
            <p className="tv-digit-panel-core-label">
              {labelDigitCore(fusion.zhiA, locale)}
            </p>
            <DigitCoreBody block={fusion.blockA} digit={fusion.zhiA} locale={locale} />
            <p className="tv-digit-panel-core-label">
              {labelDigitCore(fusion.zhiB, locale)}
            </p>
            <DigitCoreBody block={fusion.blockB} digit={fusion.zhiB} locale={locale} />

            <p className="tv-digit-panel-section-title">
              {labelFormHeading(fusion.xing, locale)}
            </p>
            <p className="tv-digit-panel-core-label">
              {labelDigitCore(fusion.xing, locale)}
            </p>
            <DigitCoreBody block={fusion.blockXing} digit={fusion.xing} locale={locale} />

            <p className="tv-digit-panel-section-title">
              {labelTraitsHeading(locale)}
            </p>
            <ul className="tv-digit-panel-list">
              {boardFeatureText(detail, locale).map((line, i) => (
                <li key={`feat-${i}`}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
