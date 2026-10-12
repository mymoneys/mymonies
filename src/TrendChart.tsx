import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect, Defs, Pattern, Line, Text as SvgText, G } from 'react-native-svg';
import { FlowType, getTrendSeries, TrendPoint, TrendRange } from './analytics';

const RANGES: TrendRange[] = ['1D', '1W', '4M', '8M', 'All'];

const CHART_HEIGHT = 200;
const TOP_PADDING = 34; // room for the peak-value bubble so it never clips off the top of the SVG
const LABEL_HEIGHT = 28; // room for the month/day labels under the bars
const BAR_AREA_HEIGHT = CHART_HEIGHT - TOP_PADDING - LABEL_HEIGHT;
const SIDE_PADDING = 10; // equal inset on both edges so the first and last bars breathe the same amount

function formatCompact(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(rounded >= 10000 ? 0 : 1)}k`;
  }
  return rounded.toLocaleString();
}

export default function TrendChart({ width }: { width: number }) {
  const [flow, setFlow] = useState<FlowType>('expense');
  const [range, setRange] = useState<TrendRange>('1W');
  const [points, setPoints] = useState<TrendPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    getTrendSeries(flow, range).then((result) => {
      if (!cancelled) setPoints(result);
    });
    return () => {
      cancelled = true;
    };
  }, [flow, range]);

  const max = Math.max(1, ...points.map((p) => p.total));
  const peakIndex = points.reduce(
    (best, p, i) => (p.total > points[best].total ? i : best),
    0
  );
  const barGap = points.length <= 5 ? 14 : points.length <= 7 ? 10 : 7;
  const innerWidth = width - SIDE_PADDING * 2;
  const barWidth = points.length > 0 ? (innerWidth - barGap * (points.length - 1)) / points.length : 0;

  return (
    <View>
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleButton, flow === 'income' && styles.toggleButtonActive]}
          onPress={() => setFlow('income')}
        >
          <Text style={[styles.toggleText, flow === 'income' && styles.toggleTextActive]}>Income</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleButton, flow === 'expense' && styles.toggleButtonActive]}
          onPress={() => setFlow('expense')}
        >
          <Text style={[styles.toggleText, flow === 'expense' && styles.toggleTextActive]}>Expenses</Text>
        </Pressable>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <Pressable
            key={r}
            style={[styles.rangePill, range === r && styles.rangePillActive]}
            onPress={() => setRange(r)}
          >
            <Text style={[styles.rangePillText, range === r && styles.rangePillTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      {points.length > 0 && max > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          <Defs>
            <Pattern
              id="hatch"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <Line x1="0" y1="0" x2="0" y2="6" stroke="#8A6A3C" strokeOpacity={0.35} strokeWidth={2} />
            </Pattern>
          </Defs>
          {points.map((p, i) => {
            const barHeight = Math.max(3, (p.total / max) * BAR_AREA_HEIGHT);
            const x = SIDE_PADDING + i * (barWidth + barGap);
            const y = TOP_PADDING + (BAR_AREA_HEIGHT - barHeight);
            const isPeak = i === peakIndex && p.total > 0;
            const labelY = Math.max(14, y - 6);
            return (
              <G key={p.label}>
                <SvgText
                  x={x + barWidth / 2}
                  y={labelY}
                  fontSize="10.5"
                  fontWeight={isPeak ? '800' : '600'}
                  fill={isPeak ? '#1E1B18' : '#8A7A66'}
                  textAnchor="middle"
                >
                  {formatCompact(p.total)}
                </SvgText>
                <Rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={Math.min(barWidth / 2.4, 10)}
                  fill={isPeak ? '#8A6A3C' : 'url(#hatch)'}
                  stroke={isPeak ? undefined : '#8A6A3C'}
                  strokeOpacity={isPeak ? 0 : 0.4}
                  strokeWidth={isPeak ? 0 : 1}
                />
                <SvgText
                  x={x + barWidth / 2}
                  y={TOP_PADDING + BAR_AREA_HEIGHT + 20}
                  fontSize="11"
                  fontWeight="600"
                  fill="#6B5E52"
                  textAnchor="middle"
                >
                  {p.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : (
        <Text style={styles.emptyText}>No {flow === 'income' ? 'income' : 'spending'} in this range yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F4F1EA',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  toggleButtonActive: {
    backgroundColor: '#FFFDF9',
  },
  toggleText: {
    color: '#6B5E52',
    fontWeight: '700',
    fontSize: 13,
  },
  toggleTextActive: {
    color: '#1E1B18',
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  rangePill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F4F1EA',
  },
  rangePillActive: {
    backgroundColor: '#1E1B18',
  },
  rangePillText: {
    color: '#6B5E52',
    fontWeight: '700',
    fontSize: 12,
  },
  rangePillTextActive: {
    color: '#FFFDF9',
  },
  emptyText: {
    color: '#6B5E52',
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
});
