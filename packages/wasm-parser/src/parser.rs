use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::types::{EdgeType, ImportInfo};

/// Parse a single JS/TS file and extract all import/export information.
pub fn parse_file(path: &str, content: &str) -> ParseResult {
    let allocator = Allocator::default();
    let source_type = detect_source_type(path);
    let parser = Parser::new(&allocator, content, source_type);
    let result = parser.parse();

    let mut imports: Vec<ImportInfo> = Vec::new();
    let mut exports: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // Collect parse errors
    for error in &result.errors {
        errors.push(error.to_string());
    }

    let program = &result.program;

    // Walk the AST to extract imports and exports
    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(import_decl) => {
                let source = import_decl.source.value.to_string();
                let mut specifiers_list = Vec::new();
                let mut edge_type = EdgeType::SideEffect;

                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                specifiers_list.push(s.local.name.to_string());
                                edge_type = EdgeType::Named;
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                                specifiers_list.push(s.local.name.to_string());
                                edge_type = EdgeType::Default;
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                                specifiers_list.push(s.local.name.to_string());
                                edge_type = EdgeType::Namespace;
                            }
                        }
                    }
                }

                imports.push(ImportInfo {
                    source,
                    specifiers: specifiers_list,
                    import_type: edge_type,
                });
            }
            Statement::ExportNamedDeclaration(export_decl) => {
                if let Some(declaration) = &export_decl.declaration {
                    extract_declaration_names(declaration, &mut exports);
                }
                for spec in &export_decl.specifiers {
                    exports.push(spec.exported.name().to_string());
                }
            }
            Statement::ExportDefaultDeclaration(_) => {
                exports.push("default".to_string());
            }
            Statement::ExportAllDeclaration(_) => {
                exports.push("*".to_string());
            }
            _ => {
                // Check for require() calls in expression statements
                if let Statement::ExpressionStatement(expr_stmt) = stmt {
                    extract_require_calls(&expr_stmt.expression, &mut imports);
                }
                // Check for variable declarations with require()
                if let Statement::VariableDeclaration(var_decl) = stmt {
                    for declarator in &var_decl.declarations {
                        if let Some(init) = &declarator.init {
                            extract_require_calls(init, &mut imports);
                        }
                    }
                }
            }
        }
    }

    let loc = content.lines().count() as u32;

    ParseResult {
        imports,
        exports,
        loc,
        errors,
    }
}

pub struct ParseResult {
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<String>,
    pub loc: u32,
    pub errors: Vec<String>,
}

fn detect_source_type(path: &str) -> SourceType {
    let lower = path.to_lowercase();
    if lower.ends_with(".tsx") {
        SourceType::tsx()
    } else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") {
        SourceType::ts()
    } else if lower.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        // .js, .mjs, .cjs — default to JS with JSX support
        SourceType::mjs()
    }
}

fn extract_declaration_names(declaration: &Declaration, names: &mut Vec<String>) {
    match declaration {
        Declaration::VariableDeclaration(var_decl) => {
            for declarator in &var_decl.declarations {
                extract_binding_names(&declarator.id, names);
            }
        }
        Declaration::FunctionDeclaration(func_decl) => {
            if let Some(id) = &func_decl.id {
                names.push(id.name.to_string());
            }
        }
        Declaration::ClassDeclaration(class_decl) => {
            if let Some(id) = &class_decl.id {
                names.push(id.name.to_string());
            }
        }
        Declaration::TSTypeAliasDeclaration(type_decl) => {
            names.push(type_decl.id.name.to_string());
        }
        Declaration::TSInterfaceDeclaration(iface_decl) => {
            names.push(iface_decl.id.name.to_string());
        }
        Declaration::TSEnumDeclaration(enum_decl) => {
            names.push(enum_decl.id.name.to_string());
        }
        _ => {}
    }
}

fn extract_binding_names(pattern: &BindingPattern, names: &mut Vec<String>) {
    match &pattern.kind {
        BindingPatternKind::BindingIdentifier(id) => {
            names.push(id.name.to_string());
        }
        BindingPatternKind::ObjectPattern(obj) => {
            for prop in &obj.properties {
                extract_binding_names(&prop.value, names);
            }
        }
        BindingPatternKind::ArrayPattern(arr) => {
            for elem in arr.elements.iter().flatten() {
                extract_binding_names(elem, names);
            }
        }
        BindingPatternKind::AssignmentPattern(assign) => {
            extract_binding_names(&assign.left, names);
        }
    }
}

fn extract_require_calls(expr: &Expression, imports: &mut Vec<ImportInfo>) {
    if let Expression::CallExpression(call) = expr {
        if let Expression::Identifier(id) = &call.callee {
            if id.name == "require" {
                if let Some(arg) = call.arguments.first() {
                    if let Argument::StringLiteral(lit) = arg {
                        imports.push(ImportInfo {
                            source: lit.value.to_string(),
                            specifiers: vec![],
                            import_type: EdgeType::Commonjs,
                        });
                    }
                }
            }
        }
    }
}
