# PowerShellでのファイル操作時のエンコーディング注意事項

## 問題

PowerShellの `Get-Content` / `Set-Content` や `-replace` 演算子でUTF-8（日本語等のマルチバイト文字）を含むファイルを処理すると、文字化けが発生する。
Windows PowerShellのデフォルトエンコーディングがUTF-8ではないことが原因。

## 禁止事項

- PowerShellの `Get-Content` + `-replace` + `Set-Content` パイプラインで日本語を含むファイルを書き換えてはならない
- `(Get-Content file) -replace 'old','new' | Set-Content file` パターンは使用禁止

## 代替策

1. **strReplaceツールを使う**（最優先）
   - ファイル内の文字列置換にはエディタのstrReplaceツールを使用する
   - エンコーディング問題が発生しない

2. **fsWriteツールでファイル全体を書き直す**
   - 大規模な変更が必要な場合はfsWrite/fsAppendで再作成する

3. **どうしてもPowerShellで置換が必要な場合**
   - 対象ファイルにマルチバイト文字が含まれていないことを事前に確認する
   - または `-Encoding UTF8` を明示的に指定する（ただしBOM付きになる可能性あり）

## まとめ

ファイル内容の置換は常にstrReplaceツールまたはfsWriteツールを使い、PowerShellのテキスト処理は避けること。
