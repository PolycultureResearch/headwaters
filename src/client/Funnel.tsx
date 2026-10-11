import { useEffect, useState } from "react";
import type { Funnel } from "../shared/types";
import { api } from "./api";
import { formatPercent } from "./format";

export function FunnelView({ version }: { version: number }) {
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  useEffect(() => {
    api.funnel().then(setFunnel, () => setFunnel(null));
  }, [version]);

  if (!funnel) return null;
  const widest = Math.max(1, ...funnel.stages.map((s) => s.reached));

  return (
    <div className="funnel">
      <div className="tiles">
        <Tile label="Leads per win" value={funnel.leads_per_win?.toString() ?? "–"} />
        <Tile
          label="Lead to won"
          value={funnel.overall_conversion === null ? "–" : formatPercent(funnel.overall_conversion)}
        />
        <Tile
          label="Median days to win"
          value={funnel.median_days_to_win === null ? "–" : Math.round(funnel.median_days_to_win).toString()}
        />
        <Tile label="Won" value={funnel.won.toString()} />
      </div>

      <table className="funnel-table">
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col" className="bar-col">
              Leads that got this far
            </th>
            <th scope="col" className="num">
              Moved on
            </th>
            <th scope="col" className="num">
              Median days here
            </th>
          </tr>
        </thead>
        <tbody>
          {funnel.stages.map((stage) => (
            <tr key={stage.stage_id}>
              <th scope="row">{stage.name}</th>
              <td className="bar-col">
                <div className="bar-track">
                  <div className="bar" style={{ width: `${(stage.reached / widest) * 100}%` }} />
                  <span className="bar-label">
                    {stage.reached}
                    {stage.open > 0 && <span className="muted"> · {stage.open} here now</span>}
                  </span>
                </div>
              </td>
              <td className="num">{stage.conversion === null ? "–" : formatPercent(stage.conversion)}</td>
              <td className="num">{stage.median_days === null ? "–" : stage.median_days}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="footnote">
        Moved on counts only leads that have left a stage: the share of them that went forward. Leads still waiting in
        a stage are left out. {funnel.lost} lost and {funnel.dormant} dormant out of {funnel.total_leads} leads. These
        numbers mean little until a few dozen leads have moved through.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
