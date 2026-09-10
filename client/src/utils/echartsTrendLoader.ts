import echarts from './echartsBase'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent } from 'echarts/components'

echarts.use([BarChart, LineChart, GridComponent, LegendComponent])

export default echarts
