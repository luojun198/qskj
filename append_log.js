const fs = require('fs');
const logFile = 'D:/BDKF/qskj/浼樺寲鏃ュ織.md';
let content = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
const date = new Date().toISOString().split('T')[0];
const append = `
## ${date}

### 1. 淇鏂板閿€鍞鍗曠櫧灞忛棶棰?
**淇敼鏂囦欢锛?*
- \`client/src/views/scm/DocList.vue\`
- \`client/src/views/scm/DocForm.vue\`

**鍏蜂綋璇存槑锛?*
1. 灏?\`DocList.vue\` 涓殑鍔ㄦ€佸垪鏍煎紡鍖栦粠鎻掓Ы (\`#default\`) 鍥為€€鍒?\`:formatter\`锛屼互瑙ｅ喅鍦ㄧ壒瀹?Element Plus 鐗堟湰涓嬫姏鍑?\`Slot invoked outside of the render function\` 璀﹀憡瀵艰嚧鐨?Vue 缁勪欢鏍戞覆鏌撲腑鏂拰璺敱鎸傝浇澶辫触闂銆?2. 鍦?\`DocForm.vue\` 涓姞鍏ヤ簡鍏ㄥ眬鐨?\`onErrorCaptured\` 閿欒杈圭晫銆傚鏋滃湪 setup 鎴?render 鏈熼棿鎶涘嚭鏈兘鎹曡幏鐨?\`el-select\` 绛夌粍浠跺唴閮ㄥ紓甯革紝灏嗙洿鎺ユ樉绀哄湪琛ㄥ崟椤堕儴鑰屼笉鏄鑷存暣涓〉闈㈢櫧灞忥紝鏂逛究鎺掓煡鏁版嵁寮傚父銆?
**鍘熷洜锛?*
- 鍏堝墠鐨勬彃妲戒娇鐢ㄥ湪璺敱鍒囨崲鍜屽垪琛ㄩ噸鐢ㄦ椂锛岀牬鍧忎簡缁勪欢娓叉煋閾捐矾锛涘悓鏃堕槻姝㈠洜鑴忔暟鎹紩璧风殑 \`el-select\` 娣卞眰缁勪欢宕╂簝瀵艰嚧椤甸潰鐩存帴涓嶆樉绀猴紙鐧藉睆锛夈€?`;
fs.writeFileSync(logFile, content + append);
