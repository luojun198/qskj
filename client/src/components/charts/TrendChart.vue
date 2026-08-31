<template>
  <div ref="chartRef" class="trend-chart"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import * as echarts from 'echarts'

interface TrendData {
  month: string
  debit: number
  credit: number
}

const props = defineProps<{
  data: TrendData[]
}>()

const chartRef = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null

const initChart = () => {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value)

  const months = props.data.map(item => item.month.slice(5) + '月')
  const debitData = props.data.map(item => item.debit)
  const creditData = props.data.map(item => item.credit)

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: (params: any) => {
        let result = `${params[0].axisValue}<br/>`
        params.forEach((item: any) => {
          const value = (item.value / 10000).toFixed(2)
          result += `${item.marker} ${item.seriesName}: ${value}万元<br/>`
        })
        return result
      }
    },
    legend: {
      data: ['借方', '贷方'],
      top: 0,
      right: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: {
        lineStyle: {
          color: '#d0d7de'
        }
      },
      axisLabel: {
        color: '#606266'
      }
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: '#606266',
        formatter: (value: number) => {
          return (value / 10000).toFixed(0) + '万'
        }
      },
      splitLine: {
        lineStyle: {
          color: '#e4e8ed',
          type: 'dashed'
        }
      }
    },
    series: [
      {
        name: '借方',
        type: 'bar',
        data: debitData,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#2e6bc4' },
            { offset: 1, color: '#1a4b8c' }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#5a8fd8' },
              { offset: 1, color: '#2e6bc4' }
            ])
          }
        },
        animationDelay: (idx: number) => idx * 50
      },
      {
        name: '贷方',
        type: 'bar',
        data: creditData,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#4caf50' },
            { offset: 1, color: '#2e7d32' }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#66bb6a' },
              { offset: 1, color: '#4caf50' }
            ])
          }
        },
        animationDelay: (idx: number) => idx * 50 + 100
      }
    ],
    animationEasing: 'cubicOut',
    animationDuration: 800
  }

  chartInstance.setOption(option)
}

const resizeChart = () => {
  chartInstance?.resize()
}

onMounted(() => {
  initChart()
  window.addEventListener('resize', resizeChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeChart)
  chartInstance?.dispose()
})

watch(() => props.data, () => {
  initChart()
}, { deep: true })
</script>

<style scoped>
.trend-chart {
  width: 100%;
  height: 300px;
}
</style>
