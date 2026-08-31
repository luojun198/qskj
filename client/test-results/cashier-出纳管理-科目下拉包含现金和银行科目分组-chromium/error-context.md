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
  - waiting for locator('.el-menu-item').filter({ hasText: '鍑虹撼鏃ヨ璐? })
    - locator resolved to <li tabindex="-1" role="menuitem" class="el-menu-item">鈥?/li>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <span class="menu-title-label">鍥哄畾璧勪骇</span> from <li role="menuitem" class="el-sub-menu" ariahaspopup="true" aria-expanded="false">鈥?/li> subtree intercepts pointer events
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <vite-error-overlay></vite-error-overlay> intercepts pointer events
  - retrying click action
    - waiting 20ms
    2 脳 waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <vite-error-overlay></vite-error-overlay> intercepts pointer events
    - retrying click action
      - waiting 100ms
    19 脳 waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <vite-error-overlay></vite-error-overlay> intercepts pointer events
     - retrying click action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
                - menuitem "馃憠 鍑虹撼鏃ヨ璐? [ref=e67] [cursor=pointer]:
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
  1  | /**
  2  |  * E2E 娴嬭瘯鍏辩敤 fixture
  3  |  *
  4  |  * 閫氳繃 API 鐩存帴鐧诲綍骞舵敞鍏?localStorage锛岀粫杩?el-select 涓嬫媺鐧诲綍 UI锛?  5  |  * 浣挎祴璇曡仛鐒﹀湪鍔熻兘楠岃瘉鑰岄潪鐧诲綍浜や簰銆?  6  |  */
  7  | import { test as base, expect, type Page } from '@playwright/test'
  8  | 
  9  | const API_BASE = 'http://127.0.0.1:3005'
  10 | const ACCOUNT_SET_ID = '5945a5a8-e9f2-4145-968f-86862ce54aa3'  // 琛屾斂璐﹀
  11 | const USERNAME = 'admin'
  12 | const PASSWORD = 'admin123'
  13 | 
  14 | /** 閫氳繃 API 鐧诲綍骞舵敞鍏?token 鍒?localStorage */
  15 | async function apiLogin(page: Page) {
  16 |   const resp = await page.request.post(`${API_BASE}/api/auth/login`, {
  17 |     data: { username: USERNAME, password: PASSWORD, targetAccountSetId: ACCOUNT_SET_ID },
  18 |   })
  19 |   const body = await resp.json()
  20 |   if (!body.token) throw new Error('鐧诲綍澶辫触: ' + JSON.stringify(body))
  21 | 
  22 |   await page.goto('/')
  23 |   await page.evaluate(({ token, asid }) => {
  24 |     localStorage.setItem('token', token)
  25 |     localStorage.setItem('accountSetId', asid)
  26 |   }, { token: body.token, asid: ACCOUNT_SET_ID })
  27 |   await page.goto('/dashboard')
  28 |   await page.waitForSelector('.el-menu', { timeout: 8000 })
  29 | }
  30 | 
  31 | /** 鎵╁睍 test锛屾彁渚涘凡鐧诲綍鐨?page fixture */
  32 | export const test = base.extend<{ loggedInPage: Page }>({
  33 |   loggedInPage: async ({ page }, use) => {
  34 |     await apiLogin(page)
  35 |     await use(page)
  36 |   },
  37 | })
  38 | 
  39 | export { expect }
  40 | 
  41 | /** 渚挎嵎鍑芥暟锛氱瓑寰?el-table 鍔犺浇锛堜笉鍚?loading 鐘舵€侊級 */
  42 | export async function waitForTable(page: Page) {
  43 |   await page.waitForSelector('.el-table', { timeout: 8000 })
  44 |   await page.waitForFunction(() => !document.querySelector('.el-loading-mask'), { timeout: 5000 })
  45 | }
  46 | 
  47 | /** 渚挎嵎鍑芥暟锛氱偣鍑讳晶杈硅彍鍗曞鑸?*/
  48 | export async function navTo(page: Page, group: string, item: string) {
  49 |   // 灞曞紑鑿滃崟鍒嗙粍锛堝鏋滆繕鏈睍寮€锛?  50 |   const groupEl = page.locator('.el-menu .el-sub-menu__title', { hasText: group })
  51 |   const isOpen = await page.locator(`.el-menu .el-sub-menu.is-opened .el-sub-menu__title`, { hasText: group }).isVisible().catch(() => false)
  52 |   if (!isOpen) await groupEl.click()
> 53 |   await page.locator('.el-menu-item', { hasText: item }).click()
     |                                                          ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
  54 |   await page.waitForTimeout(300)
  55 | }
  56 | 
```