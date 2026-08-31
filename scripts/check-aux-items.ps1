$code = @'
const Database = require("better-sqlite3");
const db = new Database("data/finance.db");
const setId = "2c7a9340-a82f-49d7-8730-fb10370442eb";
const projectType = "0f80cac2-c5d6-4053-8d09-c9559504117c";
const caseType = "5462d713-b418-42a4-aff3-c214de00a60b";
console.log("椤圭洰 category sample:", db.prepare("SELECT code,name FROM aux_items WHERE account_set_id=? AND type=? AND code IN ('100001','100002') LIMIT 5").all(setId, projectType));
console.log("妗堜欢鍙?count:", db.prepare("SELECT COUNT(*) n FROM aux_items WHERE account_set_id=? AND type=?").get(setId, caseType));
'@
Set-Location D:\BDKF\qskj
node -e $code
