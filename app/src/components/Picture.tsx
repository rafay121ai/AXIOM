import { StyleSheet, Text, View } from 'react-native';
import type { Picture as PictureData } from '../api/types';
import { copy } from '../copy';
import { scaled, shares, withUnit } from '../learn/picture';
import { fonts, ink } from '../theme';

// The fixed picture library, drawn from templates: hairlines and space, no card, no AI artwork.
// The server has checked every number; this only draws them.

function Bar({ label, value, width, dim = false }: { label: string; value: string; width: number; dim?: boolean }) {
  return (
    <View style={styles.bar}>
      <View style={styles.barText}>
        <Text style={[styles.barLabel, dim && styles.dim]}>{label}</Text>
        <Text style={styles.barValue}>{value}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, dim && styles.fillDim, { width: `${width}%` }]} /></View>
    </View>
  );
}

function Body({ picture }: { picture: PictureData }) {
  switch (picture.type) {
    case 'split_bar': {
      const { parts, unit } = picture.data;
      const widths = shares(parts.map((p) => p.value));
      return <>{parts.map((p, n) => <Bar key={n} label={p.label} value={withUnit(p.value, unit)} width={widths[n]} />)}</>;
    }
    case 'before_after_bars': {
      const { items, unit } = picture.data;
      const widths = scaled(items.flatMap((i) => [i.before, i.after]));
      return (
        <>
          {items.map((i, n) => (
            <View key={n} style={styles.group}>
              <Text style={styles.groupLabel}>{i.label}</Text>
              <Bar label={copy.learn.before} value={withUnit(i.before, unit)} width={widths[n * 2]} dim />
              <Bar label={copy.learn.after} value={withUnit(i.after, unit)} width={widths[n * 2 + 1]} />
            </View>
          ))}
        </>
      );
    }
    case 'side_by_side_table': {
      const { columns, rows } = picture.data;
      return (
        <View>
          <View style={styles.tableRow}>
            <View style={styles.tableLabel} />
            {columns.map((c, n) => <Text key={n} style={[styles.cell, styles.head]}>{c}</Text>)}
          </View>
          {rows.map((r, n) => (
            <View key={n} style={[styles.tableRow, styles.rowLine]}>
              <Text style={[styles.tableLabel, styles.rowLabel]}>{r.label}</Text>
              {r.cells.map((c, m) => <Text key={m} style={styles.cell}>{c}</Text>)}
            </View>
          ))}
        </View>
      );
    }
    case 'timeline': {
      return (
        <View>
          {picture.data.events.map((e, n) => (
            <View key={n} style={styles.event}>
              <Text style={styles.when}>{e.when}</Text>
              <Text style={styles.eventLabel}>{e.label}</Text>
            </View>
          ))}
        </View>
      );
    }
    case 'two_by_two': {
      // Quadrants run in reading order: top left, top right, bottom left, bottom right.
      const { x, y, quadrants } = picture.data;
      return (
        <View>
          <Text style={styles.axis}>{y.high}</Text>
          <View style={styles.grid}>
            {quadrants.map((q, n) => (
              <View key={n} style={[styles.quad, n % 2 === 0 && styles.quadLeft, n < 2 && styles.quadTop]}>
                <Text style={styles.quadText}>{q.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.axis}>{y.low}</Text>
          <View style={styles.axisRow}>
            <Text style={styles.axis}>{x.low}</Text>
            <Text style={styles.axis}>{x.high}</Text>
          </View>
        </View>
      );
    }
  }
}

/** One picture. The label over it says whose numbers they are; "Calculated" shows when the server worked a number out. */
export function Picture({ picture }: { picture: PictureData }) {
  return (
    <View style={styles.art}>
      <View style={styles.label}>
        <Text style={styles.labelText}>{picture.data.title ?? copy.learn.pictureLabel}</Text>
        {picture.derived.length > 0 && <Text style={styles.labelText}>{copy.learn.calculated}</Text>}
      </View>
      <Body picture={picture} />
    </View>
  );
}

const styles = StyleSheet.create({
  art: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: ink(0.12), paddingTop: 18, paddingBottom: 16, marginTop: 6, marginBottom: 24 },
  label: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  labelText: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.42) },
  bar: { marginBottom: 15 },
  barText: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  barLabel: { fontFamily: fonts.sans, fontSize: 13, color: ink(0.75), flex: 1, paddingRight: 12 },
  barValue: { fontFamily: fonts.sans, fontSize: 13, color: ink(0.55), fontVariant: ['tabular-nums'] },
  dim: { color: ink(0.5) },
  track: { height: 2, backgroundColor: ink(0.1), borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: ink(0.38) },
  fillDim: { backgroundColor: ink(0.2) },
  group: { marginBottom: 6 },
  groupLabel: { fontFamily: fonts.sans, fontSize: 13, color: ink(0.9), marginBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: ink(0.08) },
  tableLabel: { flex: 1.1, paddingRight: 10 },
  rowLabel: { fontFamily: fonts.sans, fontSize: 13, color: ink(0.9) },
  head: { fontFamily: fonts.sans, color: ink(0.5), fontSize: 11.5 },
  cell: { flex: 1, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: ink(0.75), paddingRight: 8 },
  event: { flexDirection: 'row', paddingVertical: 7, gap: 14 },
  when: { width: 86, fontFamily: fonts.sans, fontSize: 12.5, color: ink(0.5) },
  eventLabel: { flex: 1, fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: ink(0.85) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 },
  quad: { width: '50%', minHeight: 64, padding: 10, justifyContent: 'center', borderColor: ink(0.14) },
  quadLeft: { borderRightWidth: 1 },
  quadTop: { borderBottomWidth: 1 },
  quadText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: ink(0.85), textAlign: 'center' },
  axis: { fontFamily: fonts.sans, fontSize: 11, color: ink(0.42), textAlign: 'center' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
