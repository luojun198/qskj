<template>
  <div ref="chartRef" class="pie-chart"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import * as echarts from 'echarts'

interface PieData {
  name: string
  value: number
}

const props = defineProps<{
  data: PieData[]
  title?: string
}>()

const chartRef = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null

const initChart = () => {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value)

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
      trigger: 'item',
      formatter: (params: any) => {
        const value = (params.value / 10000).toFixed(2)
        return `${params.marker} ${params.name}<br/>金额: ${value}万元<br/>占比: ${params.percent}%`
      }
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: {
        color: '#606266'
      }
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: {
          show: false,
          position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 16,
            fontWeight: 'bold',
            formatter: (params: any) => {
              const value = (params.value / 10000).toFixed(2)
              return `${params.name}\n${value}万元`
            }
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        },
        labelLine: {
          show: false
        },
        data: props.data,
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDelay: (idx: number) => idx * 100
      }
    ],
    color: ['#1a4b8c', '#2e7d32', '#c17b1a', '#607d8b', '#d4a574']
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
.pie-chart {
  width: 100%;
  height: 280px;
}
</style>
