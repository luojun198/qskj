# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cashier.spec.ts >> 鍑虹撼绠＄悊 >> 绉戠洰涓嬫媺鍖呭惈鐜伴噾鍜岄摱琛岀鐩垎缁?- Location: e2e\cashier.spec.ts:21:3

# Error details

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('.el-select').first()

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic "鍥炲埌棣栭〉" [ref=e5] [cursor=pointer]:
        - generic [ref=e6]:
          - img "鐩涗簬鏅? [ref=e8]
          - generic [ref=e9]:
            - generic [ref=e10]: 鐩涗簬鏅?            - generic [ref=e11]: 琛屾斂浜嬩笟鍗曚綅璐㈠姟涓撲笟鐗?      - menubar [ref=e12]:
        - menuitem "鍑瘉绠＄悊" [ref=e13]:
          - generic [ref=e14] [cursor=pointer]:
            - generic [ref=e15]:
              - img [ref=e17]
              - generic [ref=e19]: 鍑瘉绠＄悊
            - img [ref=e21]
          - text: 馃憠 馃憠 馃憠 馃憠 馃憠
        - menuitem "璐︾翱绠＄悊" [ref=e23]:
          - generic [ref=e24] [cursor=pointer]:
            - generic [ref=e25]:
              - img [ref=e27]
              - generic [ref=e29]: 璐︾翱绠＄悊
            - img [ref=e31]
          - text: 馃憠 馃憠 馃憠 馃憠 馃憠
        - menuitem "杈呭姪鏍哥畻" [ref=e33]:
          - generic [ref=e34] [cursor=pointer]:
            - generic [ref=e35]:
              - img [ref=e37]
              - generic [ref=e39]: 杈呭姪鏍哥畻
            - img [ref=e41]
          - text: 馃憠 馃憠 馃憠
        - menuitem "鎶ヨ〃绠＄悊" [ref=e43]:
          - generic [ref=e44] [cursor=pointer]:
            - generic [ref=e45]:
              - img [ref=e47]
              - generic [ref=e49]: 鎶ヨ〃绠＄悊
            - img [ref=e51]
          - text: 馃憠 馃憠 馃憠
        - menuitem "鍑虹撼绠＄悊" [expanded] [ref=e53]:
          - generic [ref=e54] [cursor=pointer]:
            - generic [ref=e55]:
              - img [ref=e57]
              - generic [ref=e60]: 鍑虹撼绠＄悊
            - img [ref=e62]
          - menu [ref=e64]:
            - listitem [ref=e65]:
              - list [ref=e66]:
                - menuitem "馃憠 鍑虹撼鏃ヨ璐? [active] [ref=e67] [cursor=pointer]:
                  - generic [ref=e68]:
                    - text: 馃憠
                    - generic [ref=e69]: 鍑虹撼鏃ヨ璐?                - menuitem "馃憠 鍑虹撼鏃ユ姤" [ref=e70] [cursor=pointer]:
                  - generic [ref=e71]:
                    - text: 馃憠
                    - generic [ref=e72]: 鍑虹撼鏃ユ姤
                - menuitem "馃憠 鍑虹撼娴佹按璐? [ref=e73] [cursor=pointer]:
                  - generic [ref=e74]:
                    - text: 馃憠
                    - generic [ref=e75]: 鍑虹撼娴佹按璐?                - menuitem "馃憠 鍑虹撼鏈熷垵" [ref=e76] [cursor=pointer]:
                  - generic [ref=e77]:
                    - text: 馃憠
                    - generic [ref=e78]: 鍑虹撼鏈熷垵
                - menuitem "馃憠 瀵硅处鍗曞鍏? [ref=e79] [cursor=pointer]:
                  - generic [ref=e80]:
                    - text: 馃憠
                    - generic [ref=e81]: 瀵硅处鍗曞鍏?                - menuitem "馃憠 浣欓璋冭妭琛? [ref=e82] [cursor=pointer]:
                  - generic [ref=e83]:
                    - text: 馃憠
                    - generic [ref=e84]: 浣欓璋冭妭琛?        - menuitem "鍥哄畾璧勪骇" [ref=e85]:
          - generic [ref=e86] [cursor=pointer]:
            - generic [ref=e87]:
              - img [ref=e89]
              - generic [ref=e93]: 鍥哄畾璧勪骇
            - img [ref=e95]
          - text: 馃憠 馃憠 馃憠
        - menuitem "鍩虹璁剧疆" [ref=e97]:
          - generic [ref=e98] [cursor=pointer]:
            - generic [ref=e99]:
              - img [ref=e101]
              - generic [ref=e105]: 鍩虹璁剧疆
            - img [ref=e107]
          - text: 馃憠 馃憠 馃憠 馃憠 馃憠 馃憠 馃憠
        - menuitem "绯荤粺绠＄悊" [ref=e109]:
          - generic [ref=e110] [cursor=pointer]:
            - generic [ref=e111]:
              - img [ref=e113]
              - generic [ref=e115]: 绯荤粺绠＄悊
            - img [ref=e117]
          - text: 馃憠 馃憠 馃憠 馃憠 馃憠
        - menuitem "鏁版嵁瀹夊叏" [ref=e119]:
          - generic [ref=e120] [cursor=pointer]:
            - generic [ref=e121]:
              - img [ref=e123]
              - generic [ref=e127]: 鏁版嵁瀹夊叏
            - img [ref=e129]
          - text: 馃憠
      - button "鏀惰捣鑿滃崟" [ref=e132] [cursor=pointer]:
        - img [ref=e133]
    - generic [ref=e135]:
      - generic [ref=e136]:
        - generic:
          - navigation "闈㈠寘灞?:
            - generic:
              - link
        - generic [ref=e137]:
          - generic [ref=e138]:
            - generic [ref=e139]: 褰撳墠璐﹀锛?            - img [ref=e141]
            - generic [ref=e144]: 鏈€夎处濂?          - generic [ref=e145]:
            - generic [ref=e146]: 褰撳墠鐢ㄦ埛锛?            - img [ref=e148]
            - generic [ref=e151]: 绯荤粺绠＄悊鍛?          - generic [ref=e152]:
            - button "鍒囨崲鎿嶄綔鍛? [ref=e153] [cursor=pointer]:
              - img [ref=e155]
              - generic [ref=e158]: 鍒囨崲鎿嶄綔鍛?            - button "鍒囨崲璐﹀" [ref=e159] [cursor=pointer]:
              - img [ref=e161]
              - generic [ref=e166]: 鍒囨崲璐﹀
          - generic [ref=e167]:
            - button "棣栭〉" [ref=e168] [cursor=pointer]:
              - img [ref=e170]
              - generic [ref=e173]: 棣栭〉
            - button "杩斿洖" [disabled] [ref=e174]:
              - img [ref=e176]
              - generic [ref=e178]: 杩斿洖
            - button "閫€鍑? [ref=e179] [cursor=pointer]:
              - img [ref=e181]
              - generic [ref=e184]: 閫€鍑?      - main [ref=e185]:
        - generic [ref=e187]:
          - generic [ref=e192]:
            - generic [ref=e193]:
              - generic [ref=e194]:
                - img [ref=e196]
                - text: 璐㈠姟椹鹃┒鑸?路 鐩涗簬鏅?              - heading "鏅氫笂濂斤紝杈涜嫤浜? [level=1] [ref=e198]
              - generic [ref=e199]:
                - paragraph [ref=e200]: 2026骞?6鏈?1鏃?鏄熸湡涓€ 20:37
                - generic [ref=e201]:
                  - generic [ref=e202]:
                    - generic [ref=e203]: 褰撳墠璐﹀
                    - generic [ref=e204]: 鏈€夎处濂?                  - generic [ref=e205]:
                    - generic [ref=e206]: 褰撳墠鐢ㄦ埛
                    - generic [ref=e207]: 绯荤粺绠＄悊鍛?                  - generic [ref=e208]:
                    - generic [ref=e209]: 浼氳鍖洪棿
                    - generic [ref=e210]: 2026 骞寸 6 鏈?            - generic [ref=e211]:
              - button "鍑瘉褰曞叆 鏂板鍑瘉" [ref=e212] [cursor=pointer]:
                - img [ref=e215]
                - generic [ref=e217]:
                  - generic [ref=e218]: 鍑瘉褰曞叆
                  - generic [ref=e219]: 鏂板鍑瘉
                - img [ref=e220]
              - button "鍑瘉绠＄悊 瀹℃牳涓庤璐? [ref=e222] [cursor=pointer]:
                - img [ref=e225]
                - generic [ref=e228]:
                  - generic [ref=e229]: 鍑瘉绠＄悊
                  - generic [ref=e230]: 瀹℃牳涓庤璐?                - img [ref=e231]
              - button "浣欓琛?鎵撳紑绉戠洰浣欓琛? [ref=e233] [cursor=pointer]:
                - img [ref=e236]
                - generic [ref=e238]:
                  - generic [ref=e239]: 浣欓琛?                  - generic [ref=e240]: 鎵撳紑绉戠洰浣欓琛?                - img [ref=e241]
              - button "鏃ヨ璐?鐜伴噾閾惰娴佹按" [ref=e243] [cursor=pointer]:
                - img [ref=e246]
                - generic [ref=e248]:
                  - generic [ref=e249]: 鏃ヨ璐?                  - generic [ref=e250]: 鐜伴噾閾惰娴佹按
                - img [ref=e251]
          - generic [ref=e254]:
            - button "鏈湀鍑瘉 3 2026 骞寸 6 鏈? [ref=e255] [cursor=pointer]:
              - img [ref=e258]
              - generic [ref=e260]:
                - generic [ref=e261]: 鏈湀鍑瘉
                - generic [ref=e262]: "3"
                - generic [ref=e263]: 2026 骞寸 6 鏈?            - button "鏈璐﹀嚟璇?3 鑽夌 + 宸插鏍?3" [ref=e264] [cursor=pointer]:
              - img [ref=e267]
              - generic [ref=e269]:
                - generic [ref=e270]: 鏈璐﹀嚟璇?                - generic [ref=e271]: "3"
                - generic [ref=e272]: 鑽夌 + 宸插鏍?              - generic [ref=e273]: "3"
            - button "璐у竵璧勯噾 楼6,500.00 鐜伴噾涓庨摱琛屼綑棰? [ref=e274] [cursor=pointer]:
              - img [ref=e277]
              - generic [ref=e281]:
                - generic [ref=e282]: 璐у竵璧勯噾
                - generic [ref=e283]: 楼6,500.00
                - generic [ref=e284]: 鐜伴噾涓庨摱琛屼綑棰?            - button "鏈湀鏀跺叆 楼0.00 鏀跺叆绫诲彂鐢熼" [ref=e285] [cursor=pointer]:
              - img [ref=e288]
              - generic [ref=e292]:
                - generic [ref=e293]: 鏈湀鏀跺叆
                - generic [ref=e294]: 楼0.00
                - generic [ref=e295]: 鏀跺叆绫诲彂鐢熼
            - button "鏈湀鏀嚭 楼0.00 鏀嚭璐圭敤鍙戠敓棰? [ref=e296] [cursor=pointer]:
              - img [ref=e299]
              - generic [ref=e301]:
                - generic [ref=e302]: 鏈湀鏀嚭
                - generic [ref=e303]: 楼0.00
                - generic [ref=e304]: 鏀嚭璐圭敤鍙戠敓棰?            - button "鏈湀缁撲綑 楼0.00 鏀舵敮缁撲綑涓烘" [ref=e305] [cursor=pointer]:
              - img [ref=e308]
              - generic [ref=e311]:
                - generic [ref=e312]: 鏈湀缁撲綑
                - generic [ref=e313]: 楼0.00
                - generic [ref=e314]: 鏀舵敮缁撲綑涓烘
          - generic [ref=e315]:
            - generic [ref=e317]:
              - generic [ref=e318]:
                - img [ref=e320]
                - generic [ref=e323]:
                  - text: 瓒嬪娍鍒嗘瀽
                  - heading "杩?6 鏈熸敹鍏ヤ笌鏀嚭缁撴瀯" [level=3] [ref=e324]
                  - paragraph [ref=e325]:
                    - text: 鍙栨暟鍙ｅ緞锛氭斂搴滀細璁″埗搴?                    - link "閰嶇疆鍙栨暟瑙勫垯" [ref=e326] [cursor=pointer]:
                      - /url: /system/param?openDashboardRules=1
              - generic [ref=e327]:
                - generic [ref=e328]: 鏀跺叆
                - generic [ref=e330]: 鏀嚭
                - generic [ref=e332]: 璐圭敤
                - generic [ref=e334]: 鎴愭湰
                - generic [ref=e336]: 缁撲綑
            - generic [ref=e341]:
              - generic [ref=e342]:
                - generic [ref=e343]:
                  - img [ref=e345]
                  - generic [ref=e347]:
                    - text: 寰呭姙椋庨櫓
                    - heading "澶勭悊鎻愰啋" [level=3] [ref=e348]
                - generic [ref=e349]: 2 椤归渶鍏虫敞
              - generic [ref=e350]:
                - generic [ref=e351]:
                  - generic [ref=e353]: 鑽夌鍑瘉
                  - generic [ref=e354]: "3"
                - generic [ref=e355]:
                  - generic [ref=e357]: 寰呰璐﹀嚟璇?                  - generic [ref=e358]: "0"
                - generic [ref=e359]:
                  - generic [ref=e361]: 璐у竵璧勯噾璐熸暟
                  - generic [ref=e362]: "1"
                - generic [ref=e363]:
                  - generic [ref=e365]: 杈呭姪鏍哥畻缂哄け
                  - generic [ref=e366]: "0"
          - generic [ref=e367]:
            - generic [ref=e368]:
              - generic [ref=e369]:
                - generic [ref=e370]:
                  - img [ref=e372]
                  - generic [ref=e375]:
                    - text: 涓氬姟娴佹按
                    - heading "杩戞湡鍑瘉" [level=3] [ref=e376]
                - button "鏌ョ湅鍏ㄩ儴" [ref=e377] [cursor=pointer]:
                  - text: 鏌ョ湅鍏ㄩ儴
                  - img [ref=e378]
              - generic [ref=e380]:
                - generic [ref=e381]:
                  - generic [ref=e382]: 鏃ユ湡
                  - generic [ref=e383]: 鍑瘉鍙?                  - generic [ref=e384]: 鎽樿
                  - generic [ref=e385]: 鐘舵€?                  - generic [ref=e386]: 閲戦
                - button "06-28 003 鍑虹撼瀵硅处鐢熸垚 鈥?100201 鑽夌 楼4,500.00" [ref=e387] [cursor=pointer]:
                  - generic [ref=e388]: 06-28
                  - generic [ref=e389]: "003"
                  - generic "鍑虹撼瀵硅处鐢熸垚 鈥?100201" [ref=e390]
                  - generic [ref=e391]: 鑽夌
                  - generic [ref=e392]: 楼4,500.00
                - button "06-25 璁?002 E2E鍚屾娴嬭瘯 鑽夌 楼5,000.00" [ref=e393] [cursor=pointer]:
                  - generic [ref=e394]: 06-25
                  - generic [ref=e395]: 璁?002
                  - generic "E2E鍚屾娴嬭瘯" [ref=e396]
                  - generic [ref=e397]: 鑽夌
                  - generic [ref=e398]: 楼5,000.00
                - button "06-25 璁?001 E2E鍑瘉鑷姩鍚屾 鑽夌 楼3,000.00" [ref=e399] [cursor=pointer]:
                  - generic [ref=e400]: 06-25
                  - generic [ref=e401]: 璁?001
                  - generic "E2E鍑瘉鑷姩鍚屾" [ref=e402]
                  - generic [ref=e403]: 鑽夌
                  - generic [ref=e404]: 楼3,000.00
            - generic [ref=e405]:
              - generic [ref=e407]:
                - img [ref=e409]
                - generic [ref=e412]:
                  - text: 璧勯噾娲炲療
                  - heading "鐜伴噾閾惰缁撴瀯" [level=3] [ref=e413]
              - generic [ref=e414]:
                - generic [ref=e415]:
                  - generic [ref=e416]:
                    - generic [ref=e417]: 鐜伴噾
                    - generic [ref=e418]: 楼8,000.00
                  - generic [ref=e424]:
                    - generic [ref=e425]:
                      - generic "100101 鐜伴噾" [ref=e428]
                      - generic [ref=e429]:
                        - strong [ref=e430]: 楼8,000.00
                        - emphasis [ref=e431]: 100%
                    - generic [ref=e432]:
                      - generic "100102 鍙楁墭浠ｇ悊璧勪骇" [ref=e435]
                      - generic [ref=e436]:
                        - strong [ref=e437]: 楼0.00
                        - emphasis [ref=e438]: 0%
                - generic [ref=e439]:
                  - generic [ref=e440]:
                    - generic [ref=e441]: 閾惰
                    - generic [ref=e442]: 楼-1,500.00
                  - generic [ref=e448]:
                    - generic [ref=e449]:
                      - generic "100201 鏈崟浣? [ref=e452]
                      - generic [ref=e453]:
                        - strong [ref=e454]: 楼-1,500.00
                        - emphasis [ref=e455]: "-100%"
                    - generic [ref=e456]:
                      - generic "100202 鍙楁墭浠ｇ悊璧勪骇" [ref=e459]
                      - generic [ref=e460]:
                        - strong [ref=e461]: 楼0.00
                        - emphasis [ref=e462]: 0%
            - generic [ref=e463]:
              - generic [ref=e465]:
                - img [ref=e467]
                - generic [ref=e468]:
                  - text: 绉戠洰娲昏穬搴?                  - heading "鏈湡鍙戠敓棰?Top 5" [level=3] [ref=e469]
              - generic [ref=e470]:
                - generic [ref=e472]:
                  - generic [ref=e473]: 100201 鏈崟浣?                  - generic [ref=e474]: 楼4,500.00
                - generic [ref=e478]:
                  - generic [ref=e479]: 2001 鐭湡鍊熸
                  - generic [ref=e480]: 楼11,000.00
                - generic [ref=e484]:
                  - generic [ref=e485]: 100101 鐜伴噾
                  - generic [ref=e486]: 楼8,000.00
          - generic [ref=e492]: 鐩涗簬鏅?路 琛屾斂浜嬩笟鍗曚綅璐㈠姟涓撲笟鐗?  - generic [ref=e495]:
    - generic [ref=e496]: "[plugin:vite:import-analysis] Failed to resolve import \"element-plus/es/components/month-picker/style/css\" from \"src/views/cashier/Journal.vue\". Does the file exist?"
    - generic [ref=e497]: D:/BDKF/qskj/client/src/views/cashier/Journal.vue:2:136
    - generic [ref=e498]: "1 | /* unplugin-vue-components disabled */import { ElTag as __unplugin_components_14 } from 'element-plus/es';import 'element-plus/es/components/base/style/css';import 'element-plus/es/components/tag/style/css'; 2 | import { ElMonthPicker as __unplugin_components_13 } from 'element-plus/es';import 'element-plus/es/components/base/style/css';import 'element-plus/es/components/month-picker/style/css'; | ^ 3 | import { ElDialog as __unplugin_components_12 } from 'element-plus/es';import 'element-plus/es/components/base/style/css';import 'element-plus/es/components/dialog/style/css'; 4 | import { ElForm as __unplugin_components_11 } from 'element-plus/es';import 'element-plus/es/components/base/style/css';import 'element-plus/es/components/form/style/css';"
    - generic [ref=e499]: at TransformPluginContext._formatError (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49258:41) at TransformPluginContext.error (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49253:16) at normalizeUrl (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64307:23) at process.processTicksAndRejections (node:internal/process/task_queues:104:5) at async file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64439:39 at async Promise.all (index 5) at async TransformPluginContext.transform (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64366:7) at async PluginContainer.transform (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49099:18) at async loadAndTransform (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51978:27) at async viteTransformMiddleware (file:///D:/BDKF/qskj/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:62106:24
    - generic [ref=e500]:
      - text: Click outside, press Esc key, or fix the code to dismiss.
      - text: You can also disable this overlay by setting
      - code [ref=e501]: server.hmr.overlay
      - text: to
      - code [ref=e502]: "false"
      - text: in
      - code [ref=e503]: vite.config.js
      - text: .
```

# Test source

```ts
  1   | /**
  2   |  * 鍑虹撼绠＄悊 E2E 娴嬭瘯
  3   |  *
  4   |  * 瑕嗙洊锛氶〉闈㈡覆鏌?/ 绉戠洰鍔犺浇 / 鏃ヨ璐﹀綍鍏ヤ笌鏌ヨ / 浣欓璁＄畻 / 閾惰瀵硅处 / 鏈熷垵浣欓
  5   |  */
  6   | import { test, expect, waitForTable, navTo } from './fixtures'
  7   | 
  8   | const API = 'http://127.0.0.1:3005'
  9   | 
  10  | test.describe('鍑虹撼绠＄悊', () => {
  11  |   // 鈹€鈹€ 鏃ヨ璐﹂〉闈?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  12  | 
  13  |   test('鍑虹撼鏃ヨ璐﹂〉闈㈣兘姝ｅ父娓叉煋', async ({ loggedInPage: page }) => {
  14  |     await navTo(page, '鍑虹撼绠＄悊', '鍑虹撼鏃ヨ璐?)
  15  |     await expect(page.locator('h3')).toContainText('鍑虹撼鏃ヨ璐?)
  16  |     await expect(page.locator('.el-table')).toBeVisible()
  17  |     // 绉戠洰涓嬫媺鑷姩鍔犺浇鐜伴噾/閾惰绉戠洰
  18  |     await expect(page.locator('.el-select').first()).toBeVisible()
  19  |   })
  20  | 
  21  |   test('绉戠洰涓嬫媺鍖呭惈鐜伴噾鍜岄摱琛岀鐩垎缁?, async ({ loggedInPage: page }) => {
  22  |     await navTo(page, '鍑虹撼绠＄悊', '鍑虹撼鏃ヨ璐?)
> 23  |     await page.locator('.el-select').first().click()
      |                                              ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
  24  |     await page.waitForSelector('.el-select-dropdown', { timeout: 5000 })
  25  |     // 鏈熸湜鏈夈€岀幇閲戠鐩€嶆垨銆岄摱琛屽瓨娆俱€嶅垎缁勬爣棰?  26  |     const dropdown = page.locator('.el-select-dropdown')
  27  |     await expect(dropdown).toBeVisible()
  28  |     const optionCount = await dropdown.locator('.el-select-dropdown__item').count()
  29  |     expect(optionCount).toBeGreaterThan(0)
  30  |   })
  31  | 
  32  |   test('鑳藉綍鍏ュ嚭绾虫棩璁拌处骞跺湪鍒楄〃鏄剧ず', async ({ loggedInPage: page, request }) => {
  33  |     const asid = '5945a5a8-e9f2-4145-968f-86862ce54aa3'
  34  |     // 鍙?token
  35  |     const lr = await request.post(`${API}/api/auth/login`, {
  36  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  37  |     })
  38  |     const { token } = await lr.json()
  39  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  40  | 
  41  |     // API 鐩存帴鍒涘缓涓€鏉℃棩璁拌处锛圲I 褰曞叆鍦ㄥ墠绔祴璇曡鐩栵級
  42  |     const createRes = await request.post(`${API}/api/cashier/journal`, {
  43  |       headers,
  44  |       data: {
  45  |         account_code: '1001',
  46  |         biz_date: '2026-06-15',
  47  |         summary: 'E2E娴嬭瘯-鎻愬彇澶囩敤閲?,
  48  |         debit: 1500,
  49  |         credit: 0,
  50  |         counter_unit: 'E2E娴嬭瘯鍗曚綅',
  51  |       },
  52  |     })
  53  |     expect(createRes.ok()).toBeTruthy()
  54  |     const { data: { id: journalId } } = await createRes.json()
  55  | 
  56  |     // 鏌ヨ鏃ヨ璐?API 楠岃瘉鍐欏叆
  57  |     const listRes = await request.get(
  58  |       `${API}/api/cashier/journal?account_code=1001`,
  59  |       { headers }
  60  |     )
  61  |     const listData = await listRes.json()
  62  |     expect(listData.code).toBe(0)
  63  |     const row = listData.data.rows.find((r: any) => r.id === journalId)
  64  |     expect(row).toBeDefined()
  65  |     expect(row.debit).toBe(1500)
  66  |     expect(row.summary).toBe('E2E娴嬭瘯-鎻愬彇澶囩敤閲?)
  67  |     expect(typeof row.balance).toBe('number')  // 閫愯浣欓瀛樺湪
  68  | 
  69  |     // 娓呯悊
  70  |     await request.delete(`${API}/api/cashier/journal/${journalId}`, { headers })
  71  |   })
  72  | 
  73  |   test('鏃ヨ璐︿綑棰濊绠楁纭紙鏈熷垵 + 鍊?- 璐凤級', async ({ request }) => {
  74  |     const asid = '5945a5a8-e9f2-4145-968f-86862ce54aa3'
  75  |     const lr = await request.post(`${API}/api/auth/login`, {
  76  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  77  |     })
  78  |     const { token } = await lr.json()
  79  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  80  | 
  81  |     // 鏌ヨ鏈熷垵浣欓
  82  |     const ibRes = await request.get(`${API}/api/cashier/init-balance`, { headers })
  83  |     const ibData = await ibRes.json()
  84  |     expect(ibData.code).toBe(0)
  85  | 
  86  |     // 鏌ヨ鏃ヨ璐﹀垪琛紙鍚綑棰濓級
  87  |     const listRes = await request.get(`${API}/api/cashier/journal?account_code=1001`, { headers })
  88  |     const listData = await listRes.json()
  89  |     expect(listData.code).toBe(0)
  90  | 
  91  |     const { opening, rows, closing, totalDebit, totalCredit } = listData.data
  92  |     // 鏈熸湯浣欓 = 鏈熷垵 + 鏈湡鍊?- 鏈湡璐?  93  |     expect(Math.round((opening + totalDebit - totalCredit) * 100) / 100).toBeCloseTo(closing, 2)
  94  |     // 閫愯浣欓鏈€鍚庝竴琛屽簲绛変簬鏈熸湯
  95  |     if (rows.length > 0) {
  96  |       expect(rows[rows.length - 1].balance).toBeCloseTo(closing, 2)
  97  |     }
  98  |   })
  99  | 
  100 |   test('閾惰瀵硅处 API 鑳借嚜鍔ㄥ嬀瀵?, async ({ request }) => {
  101 |     const asid = '5945a5a8-e9f2-4145-968f-86862ce54aa3'
  102 |     const lr = await request.post(`${API}/api/auth/login`, {
  103 |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  104 |     })
  105 |     const { token } = await lr.json()
  106 |     const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  107 | 
  108 |     // 鍒涘缓涓€鏉℃棩璁拌处 + 瀵瑰簲鐨勯摱琛屽璐﹀崟锛堥噾棰濈浉鍚屻€佹棩鏈熺浉鍚岋級
  109 |     const date = '2026-06-20'
  110 |     const jRes = await request.post(`${API}/api/cashier/journal`, {
  111 |       headers: H,
  112 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, summary: 'E2E瀵硅处娴嬭瘯' },
  113 |     })
  114 |     const { data: { id: jId } } = await jRes.json()
  115 | 
  116 |     const sRes = await request.post(`${API}/api/cashier/bank-statement`, {
  117 |       headers: H,
  118 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, bill_no: 'STMT001' },
  119 |     })
  120 |     const { data: { id: sId } } = await sRes.json()
  121 | 
  122 |     // 鎵ц鑷姩鍕惧
  123 |     const reconRes = await request.post(`${API}/api/cashier/reconcile/auto`, {
```