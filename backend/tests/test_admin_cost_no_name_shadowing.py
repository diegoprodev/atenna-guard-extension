"""
FASE 10.9.6 — regressão: ao migrar costs.py/overview.py/usage.py pra
`from services.llm_pricing import cost_usd`, uma variável local também
chamada `cost_usd` (achado real em overview.py e usage.py) tornaria o nome
importado inacessível na função inteira (Python: uma atribuição em
QUALQUER parte do corpo da função já marca o nome como local desde o
início dela) — `UnboundLocalError` na primeira chamada de `cost_usd(...)`
que ocorresse antes da atribuição local no fluxo de execução.

Import real dos 3 módulos prova que carregam sem erro (achado explícito de
'candidate a Broken pipe' não é isso, mas um `SyntaxError`/`ImportError`
por essa colisão apareceria já na importação de qualquer jeito só se fosse
erro de sintaxe; o `UnboundLocalError` real só estoura em runtime — por
isso o teste também varre o código-fonte por reatribuição do nome).
"""
import ast
import inspect

import routes.admin.costs as costs_mod
import routes.admin.overview as overview_mod
import routes.admin.usage as usage_mod


def _reassigns_name(source: str, name: str) -> bool:
    """True se o módulo tem uma atribuição `name = ...` ou `name += ...`
    em algum escopo de função — o padrão exato que causou o bug real."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return True
    return False


def test_no_module_reassigns_the_imported_cost_usd_name():
    for mod in (costs_mod, overview_mod, usage_mod):
        source = inspect.getsource(mod)
        assert not _reassigns_name(source, "cost_usd"), (
            f"{mod.__name__} reatribui a variável local 'cost_usd', que sombreia "
            "a função importada de services.llm_pricing e quebra em runtime "
            "(UnboundLocalError) na primeira chamada anterior no fluxo."
        )
