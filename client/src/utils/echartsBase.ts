import * as echarts from 'echarts/core'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([TooltipComponent, CanvasRenderer])

export default echarts
