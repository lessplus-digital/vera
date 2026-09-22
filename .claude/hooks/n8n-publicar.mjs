// PostToolUse (mcp__n8n-native__update_workflow) — el error que más veces ha
// mordido a este proyecto: `update_workflow` deja el cambio en BORRADOR.
// Si nadie llama a `publish_workflow`, lo que corre sigue siendo la versión
// vieja y el bug "arreglado" sigue vivo (BUG-056/057/058 se cerraron dos veces
// por esto). El hook no puede publicar por ti; te lo recuerda en el momento.
process.stdin.resume()
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'Acabas de escribir un workflow de n8n. Eso NO lo deja en producción: ' +
        'llama a publish_workflow y confirma después que versionId == activeVersionId. ' +
        'Si el cambio arregla un bug del tracker, no lo cierres hasta haber verificado eso.',
    },
  }))
  process.exit(0)
})
