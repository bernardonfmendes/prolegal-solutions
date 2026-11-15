#!/usr/bin/env bash
# Depois de cada edição: se o ficheiro for JavaScript, confirma que a sintaxe é válida.
# Sai com 2 (bloqueia e devolve o erro ao Claude) quando há erro de sintaxe.
command -v node >/dev/null 2>&1 || exit 0
f=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')
case "$f" in *.js|*.mjs|*.cjs) ;; *) exit 0 ;; esac
[ -f "$f" ] || exit 0
if ! out=$(node --check "$f" 2>&1); then
  printf 'Erro de sintaxe em %s:\n%s\n' "$f" "$out" >&2
  exit 2
fi
exit 0
