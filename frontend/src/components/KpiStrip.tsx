import { MemoryIcon } from "../lib/memory-icons";
import { Badge } from "./ui/Badge";
import { useCornerNotch } from "./useCornerNotch";
import { NodeSparkline } from "./viz/NodeSparkline";

const NOTCH = [{ cxR: 33, cy: 27, r: 21 }];
const NOTCH_SWEEP = { sweep: 30 };

export type KpiTileData = {
  id: string;
  label: string;
  icon: string;
  value: string;
  caption: string;
  spark: number[];
  accent?: boolean;
};

function KpiTile({ kpi, index }: { kpi: KpiTileData; index: number }) {
  const ref = useCornerNotch(NOTCH, NOTCH_SWEEP);
  return (
    <div className="mc-kpi-wrap mc-rise" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="mc-kpi" ref={ref}>
        <div className="mc-kpi__top">
          <span className={"mc-kpi__glyph" + (kpi.accent ? " is-accent" : "")}>
            <MemoryIcon name={kpi.icon} size={17} weight={1.8} />
          </span>
          <span className="mc-kpi__label">{kpi.label}</span>
        </div>
        <div className="mc-kpi__row">
          <span className="mc-kpi__num">{kpi.value}</span>
          {kpi.accent ? <Badge tone="accent">{kpi.caption}</Badge> : null}
        </div>
        {!kpi.accent ? <div className="mc-kpi__caption">{kpi.caption}</div> : null}
        {kpi.spark.length > 0 ? (
          <div className="mc-kpi__spark">
            <NodeSparkline data={kpi.spark} accent={kpi.accent} h={42} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function KpiStrip({ items }: { items: KpiTileData[] }) {
  return (
    <div className="mc-kpis">
      {items.map((kpi, index) => (
        <KpiTile key={kpi.id} kpi={kpi} index={index} />
      ))}
    </div>
  );
}
