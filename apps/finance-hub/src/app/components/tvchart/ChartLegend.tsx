"use client";

import type { ReactNode } from "react";

import { formatPx } from "@/lib/charts/format";
import type { IndicatorSettings, LineWidthSetting } from "@/lib/charts/indicatorSettings";
import type { LegendValues } from "@/lib/charts/model";

type GearId = "ma0" | "ma1" | "ma2" | "ma3" | "ichimoku" | "bb" | "bmsb" | "vwap" | "volume" | "profile" | null;

export function ChartLegend({
  settings,
  values,
  vwapNote,
  openGear,
  onGear,
  onChange,
}: {
  settings: IndicatorSettings;
  values: LegendValues;
  vwapNote: string | null;
  openGear: GearId;
  onGear: (id: GearId) => void;
  onChange: (next: IndicatorSettings) => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-20 max-h-[52%] w-[320px] overflow-y-auto rounded-md border border-zinc-700 bg-[#131722]/95 p-2 text-xs text-zinc-100">
      {settings.ma.map((ma, index) => (
        <Row
          key={index}
          label={`SMA ${ma.period}`}
          color={ma.color}
          value={formatPx(values.mas[index] ?? null)}
          visible={ma.visible}
          gearOpen={openGear === (`ma${index}` as GearId)}
          onEye={() => updateMa(settings, onChange, index, { visible: !ma.visible })}
          onGear={() => onGear(openGear === (`ma${index}` as GearId) ? null : (`ma${index}` as GearId))}
        >
          <NumberField label="Period" value={ma.period} min={1} max={400} onChange={(period) => updateMa(settings, onChange, index, { period })} />
          <ColorField label="Color" value={ma.color} onChange={(color) => updateMa(settings, onChange, index, { color })} />
          <WidthField value={ma.width} onChange={(width) => updateMa(settings, onChange, index, { width })} />
        </Row>
      ))}
      <Row
        label="Ichimoku"
        color={settings.ichimoku.conversionColor}
        value={`${formatPx(values.conversion)}  ${formatPx(values.base)}  ${formatPx(values.spanA)}  ${formatPx(values.spanB)}`}
        visible={settings.ichimoku.visible}
        gearOpen={openGear === "ichimoku"}
        onEye={() => onChange({ ...settings, ichimoku: { ...settings.ichimoku, visible: !settings.ichimoku.visible } })}
        onGear={() => onGear(openGear === "ichimoku" ? null : "ichimoku")}
      >
        <NumberField label="Conversion" value={settings.ichimoku.conversion} min={1} max={200} onChange={(conversion) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, conversion } })} />
        <NumberField label="Base" value={settings.ichimoku.base} min={1} max={200} onChange={(base) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, base } })} />
        <NumberField label="Span B" value={settings.ichimoku.span} min={1} max={400} onChange={(span) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, span } })} />
        <NumberField label="Displacement" value={settings.ichimoku.displacement} min={1} max={100} onChange={(displacement) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, displacement } })} />
        <ColorField label="Conversion" value={settings.ichimoku.conversionColor} onChange={(conversionColor) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, conversionColor } })} />
        <ColorField label="Base" value={settings.ichimoku.baseColor} onChange={(baseColor) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, baseColor } })} />
        <ColorField label="Span A" value={settings.ichimoku.spanAColor} onChange={(spanAColor) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, spanAColor } })} />
        <ColorField label="Span B" value={settings.ichimoku.spanBColor} onChange={(spanBColor) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, spanBColor } })} />
        <ColorField label="Lagging" value={settings.ichimoku.laggingColor} onChange={(laggingColor) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, laggingColor } })} />
        <WidthField value={settings.ichimoku.width} onChange={(width) => onChange({ ...settings, ichimoku: { ...settings.ichimoku, width } })} />
      </Row>
      <Row
        label={`BB ${settings.bb.period} ${settings.bb.mult}`}
        color={settings.bb.color}
        value={formatPx(values.bbMid)}
        visible={settings.bb.visible}
        gearOpen={openGear === "bb"}
        onEye={() => onChange({ ...settings, bb: { ...settings.bb, visible: !settings.bb.visible } })}
        onGear={() => onGear(openGear === "bb" ? null : "bb")}
      >
        <NumberField label="Period" value={settings.bb.period} min={2} max={400} onChange={(period) => onChange({ ...settings, bb: { ...settings.bb, period } })} />
        <NumberField label="Stdev" value={settings.bb.mult} min={0.5} max={5} step={0.1} onChange={(mult) => onChange({ ...settings, bb: { ...settings.bb, mult } })} />
        <ColorField label="Color" value={settings.bb.color} onChange={(color) => onChange({ ...settings, bb: { ...settings.bb, color } })} />
        <WidthField value={settings.bb.width} onChange={(width) => onChange({ ...settings, bb: { ...settings.bb, width } })} />
      </Row>
      <Row
        label="Bull market support"
        color={settings.bmsb.emaColor}
        value={`${formatPx(values.bmsbSma)}  ${formatPx(values.bmsbEma)}`}
        visible={settings.bmsb.visible}
        gearOpen={openGear === "bmsb"}
        onEye={() => onChange({ ...settings, bmsb: { ...settings.bmsb, visible: !settings.bmsb.visible } })}
        onGear={() => onGear(openGear === "bmsb" ? null : "bmsb")}
      >
        <NumberField label="Weekly SMA" value={settings.bmsb.smaPeriod} min={2} max={100} onChange={(smaPeriod) => onChange({ ...settings, bmsb: { ...settings.bmsb, smaPeriod } })} />
        <NumberField label="Weekly EMA" value={settings.bmsb.emaPeriod} min={2} max={100} onChange={(emaPeriod) => onChange({ ...settings, bmsb: { ...settings.bmsb, emaPeriod } })} />
        <ColorField label="SMA" value={settings.bmsb.smaColor} onChange={(smaColor) => onChange({ ...settings, bmsb: { ...settings.bmsb, smaColor } })} />
        <ColorField label="EMA" value={settings.bmsb.emaColor} onChange={(emaColor) => onChange({ ...settings, bmsb: { ...settings.bmsb, emaColor } })} />
        <WidthField value={settings.bmsb.width} onChange={(width) => onChange({ ...settings, bmsb: { ...settings.bmsb, width } })} />
      </Row>
      <Row
        label="VWAP session"
        color={settings.vwap.color}
        value={vwapNote ?? formatPx(values.vwap)}
        visible={settings.vwap.visible}
        gearOpen={openGear === "vwap"}
        onEye={() => onChange({ ...settings, vwap: { ...settings.vwap, visible: !settings.vwap.visible } })}
        onGear={() => onGear(openGear === "vwap" ? null : "vwap")}
      >
        <ColorField label="Color" value={settings.vwap.color} onChange={(color) => onChange({ ...settings, vwap: { ...settings.vwap, color } })} />
        <WidthField value={settings.vwap.width} onChange={(width) => onChange({ ...settings, vwap: { ...settings.vwap, width } })} />
      </Row>
      <Row
        label="Up/down volume"
        color={settings.volume.up}
        value={settings.volume.visible ? "On" : "Hidden"}
        visible={settings.volume.visible}
        gearOpen={openGear === "volume"}
        onEye={() => onChange({ ...settings, volume: { ...settings.volume, visible: !settings.volume.visible } })}
        onGear={() => onGear(openGear === "volume" ? null : "volume")}
      >
        <ColorField label="Up" value={settings.volume.up} onChange={(up) => onChange({ ...settings, volume: { ...settings.volume, up } })} />
        <ColorField label="Down" value={settings.volume.down} onChange={(down) => onChange({ ...settings, volume: { ...settings.volume, down } })} />
      </Row>
      <Row
        label="Volume profile"
        color={settings.profile.up}
        value={settings.profile.visible ? `${settings.profile.bins} bins` : "Hidden"}
        visible={settings.profile.visible}
        gearOpen={openGear === "profile"}
        onEye={() => onChange({ ...settings, profile: { ...settings.profile, visible: !settings.profile.visible } })}
        onGear={() => onGear(openGear === "profile" ? null : "profile")}
      >
        <NumberField label="Bins" value={settings.profile.bins} min={8} max={80} onChange={(bins) => onChange({ ...settings, profile: { ...settings.profile, bins } })} />
        <ColorField label="Up" value={settings.profile.up} onChange={(up) => onChange({ ...settings, profile: { ...settings.profile, up } })} />
        <ColorField label="Down" value={settings.profile.down} onChange={(down) => onChange({ ...settings, profile: { ...settings.profile, down } })} />
      </Row>
      <Row
        label="Option strikes"
        color="#26C6DA"
        value={settings.book.visible ? "Book" : "Hidden"}
        visible={settings.book.visible}
        gearOpen={false}
        onEye={() => onChange({ ...settings, book: { visible: !settings.book.visible } })}
        onGear={() => onGear(null)}
      />
    </div>
  );
}

function updateMa(
  settings: IndicatorSettings,
  onChange: (next: IndicatorSettings) => void,
  index: number,
  patch: Partial<IndicatorSettings["ma"][number]>,
) {
  const ma = settings.ma.map((row, i) => (i === index ? { ...row, ...patch } : row));
  onChange({ ...settings, ma });
}

function Row({
  label,
  color,
  value,
  visible,
  gearOpen,
  onEye,
  onGear,
  children,
}: {
  label: string;
  color: string;
  value: string;
  visible: boolean;
  gearOpen: boolean;
  onEye: () => void;
  onGear: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={visible ? "mb-1" : "mb-1 opacity-60"}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="w-28 shrink-0 text-zinc-300">{label}</span>
        <span className="min-w-0 flex-1 font-medium tabular-nums leading-4" style={{ color }}>
          {value}
        </span>
        <button type="button" aria-pressed={visible} aria-label={`${visible ? "Hide" : "Show"} ${label}`} onClick={onEye} className="h-6 w-6 rounded border border-zinc-400 bg-zinc-900 text-[10px] text-zinc-100">
          {visible ? "On" : "Off"}
        </button>
        {children ? (
          <button type="button" aria-expanded={gearOpen} aria-label={`${label} settings`} onClick={onGear} className="h-6 rounded border border-zinc-400 bg-zinc-900 px-1.5 text-[10px] text-zinc-100">
            Set
          </button>
        ) : null}
      </div>
      {gearOpen && children ? <div className="mt-1 grid grid-cols-2 gap-1 rounded border border-zinc-600 bg-zinc-950 p-2">{children}</div> : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-zinc-300">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-8 rounded border border-zinc-400 bg-zinc-900 px-2 text-sm text-zinc-100"
        style={{ colorScheme: "dark" }}
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-zinc-300">
      {label}
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded border border-zinc-400 bg-zinc-900" style={{ colorScheme: "dark" }} />
    </label>
  );
}

function WidthField({ value, onChange }: { value: LineWidthSetting; onChange: (value: LineWidthSetting) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-zinc-300">
      Width
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as LineWidthSetting)}
        className="h-8 rounded border border-zinc-400 bg-zinc-900 px-2 text-sm text-zinc-100"
        style={{ colorScheme: "dark" }}
      >
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
        <option value={4}>4</option>
      </select>
    </label>
  );
}
