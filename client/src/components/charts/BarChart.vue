<template>
  <div ref="chartRef" class="bar-chart"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import * as echarts from 'echarts'

interface BarData {
  name: string
  value: number
}

const props = defineProps<{
  data: BarData[]
  title?: string
}>()

const chartRef = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null

const initChart = () => {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value)

  const names = props.data.map(item => item.name)
  const values = props.data.map(item => item.value)

  const option: echarts.EChartsOption = {
    title: {
      text: props.title || '',
      left: 'center',
      top: 10,
      textStyle: {
        fontSize: 14,
        fontWeight: 600,
        color: '#2c3e50'
      }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: (params: any) => {
        const value = (params[0].value / 10000).toFixed(2)
        return `${params[0].marker} ${params[0].name}<br/>余额: ${value}万元`
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: props.title ? '15%' : '5%',
      containLabel: true
    },
    xAxis: {
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
    yAxis: {
      type: 'category',
      data: names,
      axisLine: {
        lineStyle: {
          color: '#d0d7de'
        }
      },
      axisLabel: {
        color: '#606266',
        fontSize: 12
      },
      axisTick: {
        show: false
      }
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#1a4b8c' },
            { offset: 1, color: '#2e6bc4' }
          ]),
          borderRadius: [0, 4, 4, 0]
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#2e6bc4' },
              { offset: 1, color: '#5a8fd8' }
            ])
          }
        },
        label: {
          show: true,
          position: 'right',
          formatter: (params: any) => {
            return (params.value / 10000).toFixed(2) + '万'
          },
          color: '#606266',
          fontSize: 11
        },
        animationDelay: (idx: number) => idx * 50
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
.bar-chart {
  width: 100%;
  height: 300px;
}
</style>
