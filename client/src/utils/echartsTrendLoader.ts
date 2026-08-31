import echarts from './echartsBase'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'

echarts.use([BarChart, LineChart, GridComponent])

export default echarts
