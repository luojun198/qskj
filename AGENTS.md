# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 璇█瑙勫垯

**鎵€鏈変氦娴佸繀椤讳娇鐢ㄤ腑鏂?*锛屽寘鎷細
- 鍥炲鍜岃В閲?- 璁″垝锛圥lan锛夊唴瀹?- 浠诲姟鍒楄〃锛圱odos锛?- 浠ｇ爜娉ㄩ噴锛堥櫎闈炲凡鏈夎嫳鏂囨敞閲婇鏍硷級
- 閿欒鍒嗘瀽鍜屽缓璁?
## 鐣岄潰瑙勫垯锛堥噸瑕侊級

- **浼樺厛浣跨敤銆屽甫瀵艰埅鐨勫叏椤甸潰銆嶏紝灏介噺灏戠敤寮圭獥 / 妯℃€佹锛坋l-dialog锛夈€?*
  - 澶嶆潅浜や簰锛堝瀛楁琛ㄥ崟銆佹槑缁嗚〃鏍笺€佸垎鏋?涓嬫帹绛夊伐浣滄祦锛変竴寰嬪仛鎴愮嫭绔嬭矾鐢遍〉闈紝椤甸潰椤堕儴甯︺€岃繑鍥?+ 鏍囬 + 鍏抽敭淇℃伅銆嶅鑸潯锛屾搷浣滄寜閽斁椤甸潰椤堕儴鍙充晶鎴栧簳閮ㄣ€?  - 浠呬互涓嬫儏鍐靛彲鐢ㄥ脊绐楋細绠€鍗曠‘璁わ紙ElMessageBox.confirm锛夈€佸崟瀛楁蹇€熻緭鍏ャ€佽交閲忛€夋嫨鍣紙濡傞€夋簮鍗?閫夌墿鏂欙級銆?  - 鏂板闇€姹傛椂鑻ラ渶瑕佹壙杞借緝澶氬唴瀹癸紝榛樿鏂板缓 `views/` 鍏ㄩ〉闈?+ 鍦?`router/index.ts` 娉ㄥ唽璺敱锛岃€屼笉鏄柊澧?el-dialog銆?  - 鍙傝€冨疄鐜帮細`views/scm/StockDispatch.vue`锛堢己璐у垎鏋?鏅鸿兘涓嬫帹锛? 鍏ㄩ〉闈?+ 椤堕儴瀵艰埅銆?
## 椤圭洰涓婁笅鏂?
姣忔浼氳瘽寮€濮嬫椂锛屽厛璇诲彇浠ヤ笅鏂囦欢浜嗚В椤圭洰鐘舵€侊細

1. 璇诲彇 `.Codex-summary.md` 浜嗚В椤圭洰姒傝堪
2. 璇诲彇 `.tasks/current.md` 浜嗚В褰撳墠浠诲姟鐘舵€?
## 椤圭洰淇℃伅

- **椤圭洰鍚嶇О**锛欳W Finance锛堣储鍔¤璐︾郴缁燂級
- **椤圭洰绫诲瀷**锛歁onorepo锛坣pm workspaces锛?- **鎶€鏈爤**锛?  - 鍓嶇锛歏ue 3 + TypeScript + Vite + Element Plus + Pinia
  - 鍚庣锛歂ode.js + Express + TypeScript + SQLite (better-sqlite3)
  - 娴嬭瘯锛歏itest锛堝崟鍏冩祴璇曪級+ Playwright锛圗2E娴嬭瘯锛?- **鍓嶇鍦板潃**锛歨ttp://localhost:5175
- **鍚庣鍦板潃**锛歨ttp://localhost:3005
- **鏁版嵁搴撲綅缃?*锛歚data/finance.db`锛堝紑鍙戠幆澧冿級

## 甯哥敤寮€鍙戝懡浠?
### 鍚姩鏈嶅姟
```bash
# 鍚屾椂鍚姩鍓嶅悗绔紙鎺ㄨ崘锛?npm run dev

# 鍗曠嫭鍚姩鍓嶇
npm run dev:client

# 鍗曠嫭鍚姩鍚庣
npm run dev:server

# 鎴栦娇鐢ㄦ壒澶勭悊鑴氭湰
start-services.bat
```

### 鏋勫缓
```bash
# 鏋勫缓鍓嶅悗绔?npm run build

# 骞惰鏋勫缓锛堟洿蹇級
npm run build:parallel
```

### 娴嬭瘯
```bash
# 杩愯鎵€鏈夋祴璇?npm run test

# 鍚庣鍗曞厓娴嬭瘯
npm run test --workspace=server
npm run test:watch --workspace=server  # 鐩戝惉妯″紡
npm run test:coverage --workspace=server  # 瑕嗙洊鐜?
# 鍓嶇鍗曞厓娴嬭瘯
npm run test --workspace=client

# E2E 娴嬭瘯
npm run test:e2e --workspace=client
npm run test:e2e:ui --workspace=client  # UI 妯″紡
```

### 浠ｇ爜璐ㄩ噺
```bash
# Lint 妫€鏌?npm run lint
npm run lint:fix  # 鑷姩淇

# 浠ｇ爜鏍煎紡鍖?npm run format
npm run format:check  # 浠呮鏌?```

### 鏁版嵁搴撴搷浣?```bash
# 鍒濆鍖栨暟鎹簱锛堝垱寤鸿〃缁撴瀯鍜岄粯璁ゆ暟鎹級
npm run db:init --workspace=server

# 杩愯杩佺Щ
npm run db:migrate --workspace=server

# 鏌ョ湅杩佺Щ鐘舵€?npm run db:migrate:status --workspace=server

# 鍥炴粴杩佺Щ
npm run db:migrate:rollback --workspace=server

# 瀵煎叆 ACD 鏂囦欢
npm run db:import:acd --workspace=server
```

## 鏋舵瀯璇存槑

### 鍚庣鏋舵瀯锛堝垎灞傝璁★級

```
routes/          # 璺敱灞傦細澶勭悊 HTTP 璇锋眰銆佸弬鏁伴獙璇併€佸搷搴旀牸寮忓寲
  鈹溾攢鈹€ auth.ts           # 璁よ瘉鐩稿叧
  鈹溾攢鈹€ voucher.ts        # 鍑瘉褰曞叆
  鈹溾攢鈹€ voucherAudit.ts   # 鍑瘉瀹℃牳
  鈹溾攢鈹€ voucherPosting.ts # 鍑瘉杩囪处
  鈹溾攢鈹€ ledger.ts         # 璐︾翱鏌ヨ
  鈹溾攢鈹€ report*.ts        # 鍚勭被鎶ヨ〃
  鈹斺攢鈹€ base*.ts          # 鍩虹鏁版嵁

services/        # 涓氬姟閫昏緫灞傦細鏍稿績涓氬姟閫昏緫銆佹暟鎹鐞?  鈹溾攢鈹€ voucherQuery.ts   # 鍑瘉鏌ヨ閫昏緫
  鈹溾攢鈹€ voucherPosting.ts # 杩囪处涓氬姟閫昏緫
  鈹溾攢鈹€ ledgerQuery.ts    # 璐︾翱鏌ヨ閫昏緫
  鈹溾攢鈹€ reportQuery.ts    # 鎶ヨ〃鏌ヨ閫昏緫
  鈹斺攢鈹€ accountService.ts # 绉戠洰鏈嶅姟

db/              # 鏁版嵁璁块棶灞傦細鏁版嵁搴撹繛鎺ャ€佽縼绉?  鈹溾攢鈹€ index.ts          # 鏁版嵁搴撳垵濮嬪寲
  鈹溾攢鈹€ migrations.ts     # 杩佺Щ鎵ц鍣?  鈹斺攢鈹€ migrationList.ts  # 杩佺Щ鍒楄〃

middleware/      # 涓棿浠讹細璁よ瘉銆佹棩蹇椼€侀敊璇鐞?scripts/         # 鑴氭湰锛氭暟鎹簱鍒濆鍖栥€佽縼绉汇€佸鍏ョ瓑
```

### 鍓嶇鏋舵瀯

```
views/           # 椤甸潰缁勪欢锛堣矾鐢辩骇鍒級
  鈹溾攢鈹€ voucher/        # 鍑瘉绠＄悊
  鈹溾攢鈹€ ledger/         # 璐︾翱鏌ヨ
  鈹溾攢鈹€ report/         # 鎶ヨ〃
  鈹溾攢鈹€ base/           # 鍩虹鏁版嵁
  鈹斺攢鈹€ system/         # 绯荤粺绠＄悊

components/      # 鍙鐢ㄧ粍浠?  鈹溾攢鈹€ voucher/        # 鍑瘉鐩稿叧缁勪欢
  鈹溾攢鈹€ report/         # 鎶ヨ〃鐩稿叧缁勪欢
  鈹斺攢鈹€ print/          # 鎵撳嵃鐩稿叧缁勪欢

stores/          # Pinia 鐘舵€佺鐞?  鈹斺攢鈹€ user.ts         # 鐢ㄦ埛鐘舵€?
router/          # 璺敱閰嶇疆
api/             # API 璇锋眰灏佽
utils/           # 宸ュ叿鍑芥暟
```

## 鏍稿績鍔熻兘妯″潡

### 1. 鍑瘉绯荤粺锛坴oucher锛?- **褰曞叆**锛歚views/voucher/Entry.vue` + `routes/voucher.ts`
- **瀹℃牳**锛歚views/voucher/Audit.vue` + `routes/voucherAudit.ts`
- **杩囪处**锛歚routes/voucherPosting.ts` + `services/voucherPosting.ts`
- **鑷姩杞处**锛歚routes/voucherAutoTransfer.ts` + `services/autoTransfer.ts`
- **鎵归噺鎿嶄綔**锛歚routes/voucherBatch.ts`

### 2. 璐︾翱绯荤粺锛坙edger锛?- **鎬昏处**锛歚views/ledger/General.vue`
- **鏄庣粏璐?*锛歚views/ledger/Detail.vue`
- **搴忔椂璐?*锛歚views/ledger/Chronological.vue`
- **浣欓琛?*锛歚views/ledger/Balance.vue`
- **杈呭姪鏍哥畻**锛歚views/ledger/Aux*.vue`
- **鏌ヨ閫昏緫**锛歚services/ledgerQuery.ts`锛堟牳蹇冩煡璇㈤€昏緫锛?
### 3. 鎶ヨ〃绯荤粺锛坮eport锛?- **璧勪骇璐熷€鸿〃**锛歚routes/reportBalanceSheet.ts`
- **鍒╂鼎琛?*锛歚routes/reportIncomeStatement.ts`
- **鏉冪泭鍙樺姩琛?*锛歚routes/reportEquity.ts`
- **鍔ㄦ€佹姤琛?*锛歚views/report/DynamicReport.vue` + `routes/reportTemplate.ts`

### 4. 鍩虹鏁版嵁锛坆ase锛?- **绉戠洰绠＄悊**锛歚routes/baseAccount.ts` + `services/accountService.ts`
- **椤圭洰绠＄悊**锛歚routes/baseProject.ts`
- **鍑瘉绫诲瀷**锛歚routes/baseVoucherType.ts`
- **鎵撳嵃妯℃澘**锛歚routes/basePrintTemplate.ts`
- **鏈熷垵浣欓**锛歚routes/baseInitBalance.ts`

## 寮€鍙戣鑼?
- 鍓嶇浠ｇ爜浣嶄簬 `client/src/`
- 鍚庣浠ｇ爜浣嶄簬 `server/src/`
- 璐︾翱鏌ヨ閫昏緫鍦?`server/src/services/ledgerQuery.ts`
- 璐︾翱璺敱鍦?`server/src/routes/ledger.ts`
- 鎵€鏈?API 璺敱閮介渶瑕侀€氳繃 `middleware/auth.ts` 杩涜璁よ瘉锛堥櫎浜?`/api/auth/login`锛?- 鏁版嵁搴撴搷浣滀娇鐢?better-sqlite3 鐨勫悓姝?API

## 閲嶅惎鏈嶅姟瑙勫垯

**鍑℃槸淇敼浜嗗悗绔唬鐮侊紙`server/src/` 涓嬩换浣曟枃浠讹級锛屽繀椤诲湪瀹屾垚淇敼鍚庤嚜鍔ㄩ噸鍚墠鍚庣鏈嶅姟銆?*

### 鏂瑰紡涓€锛氫娇鐢ㄦ壒澶勭悊鑴氭湰锛堟帹鑽愶級
```bash
# 鐩存帴杩愯椤圭洰鏍圭洰褰曠殑鍚姩鑴氭湰
./start-services.bat
```

### 鏂瑰紡浜岋細鎵嬪姩閲嶅惎锛圥owerShell锛?```powershell
# 1. 鍏抽棴鍗犵敤绔彛鐨勮繘绋?foreach ($port in @(3005, 5175, 5173, 5174)) {
    $pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

# 2. 閲嶆柊鍚姩鏈嶅姟
Start-Process "cmd" -ArgumentList "/k cd /d D:\BDKF\qskj && npm run dev:server" -WindowStyle Normal
Start-Sleep -Seconds 3
Start-Process "cmd" -ArgumentList "/k cd /d D:\BDKF\qskj && npm run dev:client" -WindowStyle Normal
```

### 鏂瑰紡涓夛細浣跨敤 npm 鍛戒护
```bash
# 鍦ㄩ」鐩牴鐩綍鎵ц锛堜細鍚屾椂鍚姩鍓嶅悗绔級
npm run dev
```

**娉ㄦ剰**锛氬紑鍙戞ā寮忎笅鍚庣浣跨敤 `--watch` 妯″紡锛屼慨鏀逛唬鐮佸悗浼氳嚜鍔ㄩ噸鍚紝浣嗘煇浜涙儏鍐典笅锛堝淇敼鐜鍙橀噺銆佹暟鎹簱缁撴瀯锛変粛闇€鎵嬪姩閲嶅惎銆?
## 浼樺寲鏃ュ織鏇存柊瑙勫垯

**姣忔瀹屾垚鍔熻兘淇敼銆佷紭鍖栨垨 bug 淇鍚庯紝蹇呴』鍚屾鏇存柊 `浼樺寲鏃ュ織.md` 鏂囦欢銆?*

鏇存柊瑕佹眰锛?1. **鏃舵満**锛氬湪瀹屾垚浠ｇ爜淇敼骞舵祴璇曢€氳繃鍚庣珛鍗虫洿鏂?2. **鏍煎紡**锛氭寜鏃ユ湡鍒嗙粍锛屾瘡椤逛慨鏀瑰寘鍚細
   - 淇敼鏍囬锛堢畝鏄庢壖瑕侊級
   - 淇敼鏂囦欢鍒楄〃锛堝畬鏁磋矾寰勶級
   - 鍏蜂綋璇存槑锛堣缁嗘弿杩颁慨鏀瑰唴瀹广€佹妧鏈疄鐜帮級
   - 淇敼鍘熷洜锛堜负浠€涔堣杩欐牱鏀癸級
   - 褰卞搷鑼冨洿锛堝鏈夛級
3. **鍐呭瑕佹眰**锛?   - 璁板綍鎵€鏈変慨鏀圭殑鏂囦欢璺緞
   - 璇存槑鍏抽敭浠ｇ爜閫昏緫鍙樻洿
   - 濡傛秹鍙婂揩鎹烽敭锛屽悓姝ユ洿鏂?`蹇嵎閿?md`
   - 濡傛秹鍙婃暟鎹簱锛岃鏄庤縼绉昏剼鏈垨鎵嬪姩鎿嶄綔姝ラ
4. **鐗规畩鎯呭喌**锛?   - 鍚庣淇敼锛氭敞鏄庢槸鍚﹂渶瑕侀噸鍚湇鍔?   - 鏁版嵁搴撲慨鏀癸細娉ㄦ槑鏄惁闇€瑕佽繍琛岃縼绉昏剼鏈?   - 閰嶇疆淇敼锛氭敞鏄庢槸鍚﹂渶瑕佹洿鏂扮幆澧冨彉閲忔垨閰嶇疆鏂囦欢

绀轰緥鏍煎紡锛?```markdown
## 2026-04-26

### 1. 鍔熻兘鍚嶇О

**淇敼鏂囦欢锛?*
- `client/src/xxx.vue`
- `server/src/xxx.ts`

**鍏蜂綋璇存槑锛?*
- 璇︾粏鎻忚堪淇敼鍐呭
- 鍏抽敭浠ｇ爜閫昏緫璇存槑

**鍘熷洜锛?*
- 涓轰粈涔堣杩欐牱淇敼

**褰卞搷鑼冨洿锛?*锛堝彲閫夛級
- 瀵瑰叾浠栧姛鑳界殑褰卞搷
```
