import echarts from './echartsBase'
import { PieChart } from 'echarts/charts'
import { TitleComponent } from 'echarts/components'

echarts.use([PieChart, TitleComponent])

export default echarts
