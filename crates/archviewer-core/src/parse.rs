//! Import/export extraction from JS/TS sources using the OXC parser.

use crate::model::{ImportKind, Language, ParseError};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;

#[derive(Debug, Clone, PartialEq)]
pub struct RawImport {
    pub specifier: String,
    pub kind: ImportKind,
    pub specifiers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedFile {
    pub language: Language,
    pub loc: u32,
    pub imports: Vec<RawImport>,
    pub exports: Vec<String>,
    pub errors: Vec<ParseError>,
}

pub fn parse_source(path: &str, source: &str) -> ParsedFile {
    let language = language_of(path);
    let loc = source.lines().count() as u32;
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(path).unwrap_or_default();
    let ret = Parser::new(&allocator, source, source_type).parse();

    let errors = ret
        .diagnostics
        .iter()
        .map(|e| {
            let offset = e.labels.first().map_or(0, |l| l.offset());
            let (line, column) = line_col(source, offset as usize);
            ParseError {
                message: e.message.to_string(),
                line,
                column,
            }
        })
        .collect();

    let mut collector = Collector::default();
    collector.visit_program(&ret.program);

    ParsedFile {
        language,
        loc,
        imports: collector.imports,
        exports: collector.exports,
        errors,
    }
}

fn language_of(path: &str) -> Language {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "tsx" => Language::Tsx,
        "jsx" => Language::Jsx,
        "ts" | "mts" | "cts" => Language::Ts,
        _ => Language::Js,
    }
}

/// 1-based line and character column for a byte offset (clamped to the source).
fn line_col(source: &str, offset: usize) -> (u32, u32) {
    let mut end = offset.min(source.len());
    while !source.is_char_boundary(end) {
        end -= 1;
    }
    let before = &source[..end];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let column = before[line_start..].chars().count() + 1;
    (line as u32, column as u32)
}

#[derive(Default)]
struct Collector {
    imports: Vec<RawImport>,
    exports: Vec<String>,
}

impl Collector {
    fn push(&mut self, specifier: &str, kind: ImportKind, specifiers: Vec<String>) {
        self.imports.push(RawImport {
            specifier: specifier.to_string(),
            kind,
            specifiers,
        });
    }
}

fn is_ident(expr: &Expression, name: &str) -> bool {
    matches!(expr.get_inner_expression(), Expression::Identifier(id) if id.name == name)
}

/// Export name for `exports.n` / `module.exports.n` / `module.exports` assignment targets.
fn commonjs_export(target: &AssignmentTarget) -> Option<String> {
    let AssignmentTarget::StaticMemberExpression(m) = target else {
        return None;
    };
    if is_ident(&m.object, "exports") {
        return Some(m.property.name.to_string());
    }
    if is_ident(&m.object, "module") && m.property.name == "exports" {
        return Some("default".to_string());
    }
    if let Expression::StaticMemberExpression(inner) = m.object.get_inner_expression() {
        if is_ident(&inner.object, "module") && inner.property.name == "exports" {
            return Some(m.property.name.to_string());
        }
    }
    None
}

impl<'a> Visit<'a> for Collector {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let mut specifiers = Vec::new();
        let mut any_value = false;
        let list: &[_] = it.specifiers.as_deref().map_or(&[], |v| v.as_slice());
        for spec in list {
            match spec {
                ImportDeclarationSpecifier::ImportSpecifier(s) => {
                    specifiers.push(s.imported.name().to_string());
                    any_value |= !s.import_kind.is_type();
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {
                    specifiers.push("default".to_string());
                    any_value = true;
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {
                    specifiers.push("*".to_string());
                    any_value = true;
                }
            }
        }
        let all_type = it.import_kind.is_type() || (!list.is_empty() && !any_value);
        let kind = if all_type {
            ImportKind::TypeOnly
        } else {
            ImportKind::Static
        };
        self.push(
            it.source.value.display().to_string().as_str(),
            kind,
            specifiers,
        );
    }

    fn visit_export_named_declaration(&mut self, it: &ExportNamedDeclaration<'a>) {
        for s in &it.specifiers {
            self.exports.push(s.exported.name().to_string());
        }
        walk::walk_export_named_declaration(self, it);
    }

    fn visit_export_from_declaration(&mut self, it: &ExportFromDeclaration<'a>) {
        let kind = if it.export_kind.is_type() {
            ImportKind::TypeOnly
        } else {
            ImportKind::Reexport
        };
        let names = it
            .specifiers
            .iter()
            .map(|s| s.local.name().to_string())
            .collect();
        self.push(it.source.value.display().to_string().as_str(), kind, names);
        for s in &it.specifiers {
            self.exports.push(s.exported.name().to_string());
        }
        walk::walk_export_from_declaration(self, it);
    }

    fn visit_export_declaration(&mut self, it: &ExportDeclaration<'a>) {
        match &it.declaration {
            Declaration::VariableDeclaration(v) => {
                for d in &v.declarations {
                    for id in d.id.get_binding_identifiers() {
                        self.exports.push(id.name.to_string());
                    }
                }
            }
            Declaration::FunctionDeclaration(f) => {
                if let Some(id) = &f.id {
                    self.exports.push(id.name.to_string());
                }
            }
            Declaration::ClassDeclaration(c) => {
                if let Some(id) = &c.id {
                    self.exports.push(id.name.to_string());
                }
            }
            Declaration::TSTypeAliasDeclaration(t) => self.exports.push(t.id.name.to_string()),
            Declaration::TSInterfaceDeclaration(t) => self.exports.push(t.id.name.to_string()),
            Declaration::TSEnumDeclaration(t) => self.exports.push(t.id.name.to_string()),
            _ => {}
        }
        walk::walk_export_declaration(self, it);
    }

    fn visit_export_all_declaration(&mut self, it: &ExportAllDeclaration<'a>) {
        let kind = if it.export_kind.is_type() {
            ImportKind::TypeOnly
        } else {
            ImportKind::Reexport
        };
        self.push(
            it.source.value.display().to_string().as_str(),
            kind,
            vec!["*".to_string()],
        );
        let name = it
            .exported
            .as_ref()
            .map_or_else(|| "*".to_string(), |e| e.name().to_string());
        self.exports.push(name);
    }

    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        self.exports.push("default".to_string());
        walk::walk_export_default_declaration(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        if let TSModuleReference::ExternalModuleReference(r) = &it.module_reference {
            self.push(
                r.expression.value.display().to_string().as_str(),
                ImportKind::Require,
                vec![],
            );
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(s) = it.source.get_inner_expression() {
            self.push(
                s.value.display().to_string().as_str(),
                ImportKind::Dynamic,
                vec![],
            );
        }
        walk::walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if is_ident(&it.callee, "require") && it.arguments.len() == 1 {
            if let Some(Expression::StringLiteral(s)) = it.arguments[0]
                .as_expression()
                .map(|e| e.get_inner_expression())
            {
                self.push(
                    s.value.display().to_string().as_str(),
                    ImportKind::Require,
                    vec![],
                );
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if let Some(name) = commonjs_export(&it.left) {
            self.exports.push(name);
        }
        walk::walk_assignment_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<(String, ImportKind, Vec<String>)> {
        parse_source("a.ts", src)
            .imports
            .into_iter()
            .map(|i| (i.specifier, i.kind, i.specifiers))
            .collect()
    }
    #[test]
    fn static_named_default_namespace() {
        let k = kinds("import {a as b, c} from './x'; import d from './y'; import * as n from './z'; import './w';");
        assert_eq!(
            k[0],
            (
                "./x".into(),
                ImportKind::Static,
                vec!["a".into(), "c".into()]
            )
        );
        assert_eq!(k[1].2, vec!["default"]);
        assert_eq!(k[2].2, vec!["*"]);
        assert!(k[3].2.is_empty());
    }
    #[test]
    fn type_only() {
        let k = kinds(
            "import type {T} from './t'; import {type U} from './u'; import {type V, w} from './v';",
        );
        assert_eq!(k[0].1, ImportKind::TypeOnly);
        assert_eq!(k[1].1, ImportKind::TypeOnly);
        assert_eq!(k[2].1, ImportKind::Static);
    }
    #[test]
    fn reexports_and_exports() {
        let p = parse_source(
            "a.ts",
            "export {a} from './a'; export * from './b'; export * as ns from './c'; export const x = 1; export default 2;",
        );
        assert!(p.imports.iter().all(|i| i.kind == ImportKind::Reexport));
        assert_eq!(p.exports, vec!["a", "*", "ns", "x", "default"]);
    }
    #[test]
    fn nested_dynamic_and_require() {
        let k = kinds("function f(){ const m = require('./r'); return import('./d'); } import x = require('./e');");
        assert_eq!(
            k.iter().map(|i| i.1.clone()).collect::<Vec<_>>(),
            vec![
                ImportKind::Require,
                ImportKind::Dynamic,
                ImportKind::Require
            ]
        );
    }
    #[test]
    fn commonjs_exports() {
        let p = parse_source(
            "a.js",
            "exports.x = 1; module.exports.y = 2; module.exports = {};",
        );
        assert_eq!(p.exports, vec!["x", "y", "default"]);
    }
    #[test]
    fn syntax_error_has_position() {
        let p = parse_source("bad.ts", "const ok = 1;\nexport const x = ;\n");
        assert!(!p.errors.is_empty());
        assert_eq!(p.errors[0].line, 2);
        assert_eq!(p.loc, 2);
    }
    #[test]
    fn export_type_from_is_type_only() {
        let p = parse_source("a.ts", "export type {T} from './t';");
        assert_eq!(p.imports.len(), 1);
        assert_eq!(p.imports[0].kind, ImportKind::TypeOnly);
        assert_eq!(p.imports[0].specifiers, vec!["T"]);
    }
    #[test]
    fn local_export_has_no_import() {
        let p = parse_source("a.ts", "const N = 1; export {N};");
        assert!(p.imports.is_empty());
        assert_eq!(p.exports, vec!["N"]);
    }
    #[test]
    fn export_default_function() {
        let p = parse_source("a.ts", "export default function f(){}");
        assert_eq!(p.exports, vec!["default"]);
    }
    #[test]
    fn non_literal_require_and_import_ignored() {
        let p = parse_source("a.ts", "const x = './a'; require(x); import(x);");
        assert!(p.imports.is_empty());
    }
    #[test]
    fn ts_declaration_exports() {
        let p = parse_source(
            "a.ts",
            "export type T = 1; export interface I {} export enum E {}",
        );
        assert_eq!(p.exports, vec!["T", "I", "E"]);
    }
    #[test]
    fn error_position_after_crlf_and_multibyte() {
        // Line 2 is `const x = ;`; OXC's label points at the `;`, which is the
        // 11th character on that line (`const x = ` is 10 chars) -> column 11.
        let p = parse_source("a.ts", "const é = 1;\r\nconst x = ;");
        assert_eq!((p.errors[0].line, p.errors[0].column), (2, 11));
        // Multi-byte char on the same line before the error: `const é = ;`
        // -> `;` is the 11th character (byte offset would give 12).
        let p = parse_source("a.ts", "const é = ;");
        assert_eq!((p.errors[0].line, p.errors[0].column), (1, 11));
    }
    #[test]
    fn languages() {
        assert_eq!(parse_source("a.tsx", "").language, Language::Tsx);
        assert_eq!(parse_source("a.cjs", "").language, Language::Js);
    }

    #[test]
    fn crlf_input_counts_lines_and_reports_error_line() {
        let parsed = parse_source(
            "a.ts",
            "const a = 1;\r\nconst = ;\r\n",
        );
        assert_eq!(parsed.loc, 2);
        assert_eq!(parsed.errors[0].line, 2);
    }
}
