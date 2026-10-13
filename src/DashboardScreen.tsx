import { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PieChart } from 'react-native-chart-kit';
import {
  CategoryTotal,
  GroupTotal,
  getCategoryBreakdown,
  getGroupBreakdown,
  getMonthDateRange,
  getMonthlySummary,
  MonthlySummary,
} from './analytics';
import { exportTransactionsToCsv, shareCsvExport } from './export';
import TrendChart from './TrendChart';
import { getLifeCategoryBreakdown, LifeCategoryTotal } from './lifeCategory';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CATEGORY_COLORS = [
  '#8A6A3C', '#2E6B3E', '#A3453C', '#3C5A8A',
  '#8A3C6E', '#6E8A3C', '#3C8A83', '#8A5C3C',
];

const LIFE_CATEGORY_COLORS: Record<string, string> = {
  Needs: '#3C5A8A',
  Wants: '#8A6A3C',
  Savings: '#2E6B3E',
  Unclassified: '#9C9388',
};

const CHART_CONFIG = {
  backgroundGradientFrom: '#FFFDF9',
  backgroundGradientTo: '#FFFDF9',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(30, 27, 24, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(78, 70, 62, ${opacity})`,
  barPercentage: 0.6,
};

const screenWidth = Dimensions.get('window').width;
const CHART_WIDTH = screenWidth - 40;
// TrendChart renders inside the same .card (padding: 16 on each side), so its
// SVG needs the card's own inner padding subtracted too, or the last bar
// overflows past the card's right edge and gets clipped.
const TREND_CHART_WIDTH = CHART_WIDTH - 32;

export default function DashboardScreen() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [summary, setSummary] = useState<MonthlySummary>({ totalIncome: 0, totalExpenses: 0, netBalance: 0 });
  const [groups, setGroups] = useState<GroupTotal[]>([]);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [lifeCategories, setLifeCategories] = useState<LifeCategoryTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, groupResult, lifeCategoryResult] = await Promise.all([
        getMonthlySummary(month, year),
        getGroupBreakdown(month, year),
        getLifeCategoryBreakdown(month, year),
      ]);
      setSummary(summaryResult);
      setGroups(groupResult);
      setLifeCategories(lifeCategoryResult);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    setSelectedGroup(null);
  }, [month, year]);

  useEffect(() => {
    if (!selectedGroup) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    getCategoryBreakdown(month, year, selectedGroup).then((result) => {
      if (!cancelled) setCategories(result);
    });
    return () => {
      cancelled = true;
    };
  }, [month, year, selectedGroup]);

  function goToPreviousMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { startMs, endMs } = getMonthDateRange(month, year);
      const path = await exportTransactionsToCsv(startMs, endMs - 1);
      await shareCsvExport(path);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  // The group-level view (not drilled into a specific group) is capped to
  // the top groups + a single "Other" slice — a flat list of every group,
  // many at 0-1%, made the card feel oversized without adding information.
  // Drilling into one group still shows every category inside it in full.
  const TOP_GROUP_COUNT = 6;
  const pieSource: { name: string; total: number }[] = selectedGroup
    ? categories.map((c) => ({ name: c.category, total: c.total }))
    : (() => {
        const sorted = groups.map((g) => ({ name: g.group, total: g.total })).filter((g) => g.total > 0);
        if (sorted.length <= TOP_GROUP_COUNT) return sorted;
        const top = sorted.slice(0, TOP_GROUP_COUNT);
        const other = sorted.slice(TOP_GROUP_COUNT).reduce((sum, g) => sum + g.total, 0);
        return [...top, { name: 'Other (combined)', total: other }];
      })();

  const pieData = pieSource
    .filter((c) => c.total > 0)
    .map((c, index) => ({
      name: c.name,
      population: c.total,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      legendFontColor: '#4E463E',
      legendFontSize: 12,
    }));

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Local finance tracker</Text>
          <Text style={styles.title}>Dashboard</Text>
        </View>

        <View style={styles.monthPicker}>
          <Pressable style={styles.monthArrow} onPress={goToPreviousMonth}>
            <Text style={styles.monthArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          <Pressable style={styles.monthArrow} onPress={goToNextMonth}>
            <Text style={styles.monthArrowText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryCardIn]}>
            <Text style={styles.summaryLabel}>Total In</Text>
            <Text style={[styles.summaryValue, styles.summaryValueIn]}>
              Ksh {summary.totalIncome.toLocaleString()}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardOut]}>
            <Text style={styles.summaryLabel}>Total Out</Text>
            <Text style={[styles.summaryValue, styles.summaryValueOut]}>
              Ksh {summary.totalExpenses.toLocaleString()}
            </Text>
          </View>
        </View>
        <View style={styles.netCard}>
          <Text style={styles.summaryLabel}>Net Savings</Text>
          <Text
            style={[
              styles.netValue,
              summary.netBalance >= 0 ? styles.summaryValueIn : styles.summaryValueOut,
            ]}
          >
            {summary.netBalance >= 0 ? '+' : '−'} Ksh {Math.abs(summary.netBalance).toLocaleString()}
          </Text>
        </View>

        <Pressable style={styles.exportButton} onPress={handleExport} disabled={exporting}>
          <Text style={styles.exportButtonText}>
            {exporting ? 'Preparing export…' : `Export ${MONTH_NAMES[month - 1]} to CSV`}
          </Text>
        </Pressable>

        <View style={styles.card}>
          <View style={styles.pieHeaderRow}>
            {selectedGroup ? (
              <Pressable style={styles.backButton} onPress={() => setSelectedGroup(null)}>
                <Text style={styles.backButtonText}>‹ Groups</Text>
              </Pressable>
            ) : null}
            <Text style={styles.cardTitle}>
              {selectedGroup ? selectedGroup : 'Spending by group'}
            </Text>
          </View>
          {pieData.length > 0 ? (
            <>
              <PieChart
                data={pieData}
                width={CHART_WIDTH}
                height={180}
                chartConfig={CHART_CONFIG}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="8"
                hasLegend={false}
              />
              <View style={styles.legendList}>
                {pieData.map((slice, index) => {
                  const pct = summary.totalExpenses > 0 ? (slice.population / summary.totalExpenses) * 100 : 0;
                  const row = (
                    <View style={styles.legendRow}>
                      <View style={[styles.legendSwatch, { backgroundColor: slice.color }]} />
                      <Text style={styles.legendName} numberOfLines={1}>
                        {slice.name}
                      </Text>
                      <Text style={styles.legendValue}>
                        {pct.toFixed(0)}% · Ksh {slice.population.toLocaleString()}
                      </Text>
                    </View>
                  );
                  return selectedGroup ? (
                    <View key={`${slice.name}-${index}`}>{row}</View>
                  ) : (
                    <Pressable key={`${slice.name}-${index}`} onPress={() => setSelectedGroup(slice.name)}>
                      {row}
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.emptyChartText}>No categorized spending this month yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Needs vs Wants vs Savings</Text>
          {lifeCategories.length > 0 ? (
            <View style={styles.lifeCategoryList}>
              {lifeCategories.map((item) => {
                const total = lifeCategories.reduce((sum, c) => sum + c.total, 0);
                const pct = total > 0 ? (item.total / total) * 100 : 0;
                const color = LIFE_CATEGORY_COLORS[item.lifeCategory];
                return (
                  <View key={item.lifeCategory} style={styles.lifeCategoryRow}>
                    <View style={styles.lifeCategoryHeaderRow}>
                      <Text style={styles.lifeCategoryLabel}>{item.lifeCategory}</Text>
                      <Text style={styles.lifeCategoryValue}>
                        {pct.toFixed(0)}% · Ksh {item.total.toLocaleString()}
                      </Text>
                    </View>
                    <View style={styles.lifeCategoryTrack}>
                      <View
                        style={[
                          styles.lifeCategoryFill,
                          { width: `${Math.max(2, pct)}%`, backgroundColor: color },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyChartText}>No categorized spending this month yet.</Text>
          )}
        </View>

        <View style={[styles.card, styles.trendCard]}>
          <TrendChart width={TREND_CHART_WIDTH} />
        </View>

        {loading && <Text style={styles.loadingText}>Refreshing…</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F1EA',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  kicker: {
    color: '#8A6A3C',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#1E1B18',
    fontSize: 32,
    fontWeight: '900',
  },
  monthPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginVertical: 16,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E7DDCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: {
    color: '#1E1B18',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
  },
  monthLabel: {
    color: '#1E1B18',
    fontSize: 17,
    fontWeight: '800',
    minWidth: 160,
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3D8CA',
  },
  summaryCardIn: {},
  summaryCardOut: {},
  summaryLabel: {
    color: '#6B5E52',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  summaryValueIn: {
    color: '#2E6B3E',
  },
  summaryValueOut: {
    color: '#A3453C',
  },
  netCard: {
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginBottom: 16,
  },
  netValue: {
    fontSize: 24,
    fontWeight: '900',
  },
  exportButton: {
    backgroundColor: '#1E1B18',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 16,
  },
  exportButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFDF9',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3D8CA',
    marginBottom: 16,
    alignItems: 'center',
  },
  cardTitle: {
    alignSelf: 'flex-start',
    color: '#1E1B18',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  pieHeaderRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#E7DDCF',
    borderRadius: 12,
    marginBottom: 12,
  },
  backButtonText: {
    color: '#1E1B18',
    fontSize: 13,
    fontWeight: '700',
  },
  legendList: {
    alignSelf: 'stretch',
    marginTop: 8,
    gap: 10,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendName: {
    flex: 1,
    color: '#1E1B18',
    fontSize: 14,
    fontWeight: '600',
  },
  legendValue: {
    color: '#6B5E52',
    fontSize: 12,
    fontWeight: '700',
  },
  trendCard: {
    alignItems: 'stretch',
  },
  lifeCategoryList: {
    alignSelf: 'stretch',
    gap: 14,
  },
  lifeCategoryRow: {
    gap: 6,
  },
  lifeCategoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lifeCategoryLabel: {
    color: '#1E1B18',
    fontSize: 14,
    fontWeight: '700',
  },
  lifeCategoryValue: {
    color: '#6B5E52',
    fontSize: 12,
    fontWeight: '700',
  },
  lifeCategoryTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F0E9DC',
    overflow: 'hidden',
  },
  lifeCategoryFill: {
    height: 10,
    borderRadius: 5,
  },
  emptyChartText: {
    color: '#6B5E52',
    fontSize: 14,
    paddingVertical: 24,
  },
  loadingText: {
    color: '#8A6A3C',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
