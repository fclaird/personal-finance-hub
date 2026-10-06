import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hpiSeriesId, parseFhfaMasterCsv } from "@/lib/realEstate/hpi";

const CSV = `hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,period,index_nsa,index_sa,rstderr,note
traditional,all-transactions,quarterly,MSA,"Youngstown-Warren, OH",49660,2024,1,200.0,,,
traditional,all-transactions,quarterly,MSA,"Youngstown-Warren, OH",49660,2024,2,210.5,,,
traditional,purchase-only,monthly,MSA,"Youngstown-Warren, OH",49660,2024,6,999,,,
traditional,all-transactions,quarterly,MSA,"Baltimore-Columbia-Towson, MD",12580,2024,2,300,,,
traditional,all-transactions,quarterly,State,"Ohio",OH,2024,2,111,,,
`;

describe("parseFhfaMasterCsv", () => {
  it("keeps quarterly all-transactions MSA rows and maps a quarter to its ending month", () => {
    const rows = parseFhfaMasterCsv(CSV, ["49660", "12580"]);
    assert.deepEqual(
      rows.map((row) => ({ seriesId: row.seriesId, period: row.period, index: row.index })),
      [
        { seriesId: hpiSeriesId("49660"), period: "2024-03", index: 200 },
        { seriesId: hpiSeriesId("49660"), period: "2024-06", index: 210.5 },
        { seriesId: hpiSeriesId("12580"), period: "2024-06", index: 300 },
      ],
    );
  });
});
