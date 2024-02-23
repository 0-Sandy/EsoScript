import { ObjectLiteral, StringLiteral } from "./ast.ts";
import { MemberExpr } from "./ast.ts";
import { CallExpr } from "./ast.ts";
import { Stmt, Program, Expr, BinaryExpr, NumericLiteral, Identifier, VarDeclaration, AssignmentExpr, Property, FunctionDeclaration } from "./ast.ts"
import { tokenize, Token, TokenType } from "./lexer.ts"

export default class Parser {
    private tokens: Token[] = [];
    private not_eof(): boolean {
        return this.tokens[0].type != TokenType.EOF
    }

    private at() {
        return this.tokens[0] as Token;
    }

    private next() {
        return this.tokens.shift() as Token
    }

    // deno-lint-ignore no-explicit-any
    private expect(type: TokenType, err: any) {
        const prev = this.tokens.shift() as Token
        if (!prev || prev.type != type) {
            console.error("Error:\n", err, prev, " - Esperado: ", type)
            Deno.exit(1)
        }
        return prev
    }

    public produceAST(sourceCode: string): Program {
        this.tokens = tokenize(sourceCode)
        const program: Program = {
            kind: "Program",
            body: []
        }

        // Hasta que sea el final 
        while (this.not_eof()) {
            program.body.push(this.parse_stmt())
        }

        return program
    }

    private parse_stmt(): Stmt {
        if (this.at().type === TokenType.Identifier && this.tokens.find(t => t.type === TokenType.OpenParen) && this.tokens.findIndex((t, index) => t.type === TokenType.OpenBrace && this.tokens[index - 1].type === TokenType.CloseParen) !== -1) {
            return this.parse_fn_declaration()
        } else {
            switch (this.at().type) {
                case TokenType.Let:
                case TokenType.Const:
                    return this.parse_var_declaration();
                default:
                    return this.parse_expr();
            }
        }
    }
    parse_fn_declaration(): Stmt {
		let asyncKeyword: boolean = false;

        // Verificar si la función es asíncrona
        if (this.at().type === TokenType.Identifier && this.at().value === 'async') {
            asyncKeyword = true
            this.next();
        }

        const name = this.expect(TokenType.Identifier, "Se espera un nombre para la función que se tiene que ver de esta forma nombre(propiedades){}").value

		const args = this.parse_args();
		const params: string[] = [];
		for (const arg of args) {
			if (arg.kind !== "Identifier") {
				console.log(arg);
				throw `Se espera que los parámetros de la función sean letras en "${name}"`
			}

			params.push((arg as Identifier).symbol);
		}

		this.expect(TokenType.OpenBrace, `Se espera un { para la función "${name}"`)
		const body: Stmt[] = [];

		while (
			this.at().type !== TokenType.EOF &&
			this.at().type !== TokenType.CloseBrace
		) {
			body.push(this.parse_stmt())
		}

		this.expect(TokenType.CloseBrace, `Se espera un } para la función "${name}"`)

		const fn = {
			body,
            name,
            parameters: params,
            kind: "FunctionDeclaration",
            async: asyncKeyword
		} as FunctionDeclaration

		return fn;
	}

    // let identificador
    // ( let / const ) identificador = expr
    parse_var_declaration(): Stmt {
        const isConstant = this.next().type == TokenType.Const
        const identifier = this.expect(TokenType.Identifier, `Esperando el nombre que tiene que ser texto después de la variable de ${isConstant ? 'const' : 'let'}`).value
        if (this.tokens.length === 0 || this.at().type === TokenType.EOF) {
            if (isConstant) {
                throw `Debes asignarle un valor a la constante ${identifier}`
            }
            return { kind: "VarDeclaration", identifier, constant: false } as VarDeclaration;
        }

        this.expect(TokenType.Equals, `Se espera un = después de ${identifier}`)
        const declaration = { kind: "VarDeclaration", value: this.parse_expr(), identifier, constant: isConstant } as VarDeclaration
        return declaration;
    }

    private parse_expr(): Expr {
        return this.parse_assignment_expr();
    }

    private parse_assignment_expr(): Expr {
        const left = this.parse_object_expr()

        if (this.at().type == TokenType.Equals) {
            this.next() // Nos salteamos el =
            const value = this.parse_assignment_expr()
            return { value, assigne: left, kind: "AssignmentExpr" } as AssignmentExpr
        }

        return left;
    }

    private parse_object_expr(): Expr {
        // { ... }
        if (this.at().type !== TokenType.OpenBrace) {
            return this.parse_additive_expr()
        }

        this.next() // Nos saltamos el [
        const properties = new Array<Property>()

        while (this.not_eof() && this.at().type !== TokenType.CloseBrace) {
            // caso 1 { nombre: valor }
            // caso 2 { nombre }

            const key = this.expect(TokenType.Identifier, `Falta un nombre dentro de un objeto`).value

            // Permite multiples objetos separados por coma { nombre, nombre }
            if (this.at().type == TokenType.Comma) {
                this.next() // Nos salteamos la coma a los siguientes datos
                properties.push({ key, kind: "Property" } as Property) // Guardamos los datos
                continue // Continuamos
            }
            // Permite 1 solo objeto { nombre }
            else if (this.at().type == TokenType.CloseBrace) {
                properties.push({ key, kind: "Property" }) // Guardamos los datos
                continue // Continuamos
            }

            this.expect(TokenType.Colon, `Falta : después de ${key}`)
            const value = this.parse_expr()

            properties.push({ kind: "Property", value, key })
            if (this.at().type !== TokenType.CloseBrace) {
                this.expect(TokenType.Comma, `Se espera una coma o que se cierre el objeto después de la siguiente propiedad`)
            }
        }

        this.expect(TokenType.CloseBrace, `Falta cerrar el objeto`)
        return { kind: "ObjectLiteral", properties } as ObjectLiteral
    }

    private parse_additive_expr(): Expr {
        let left = this.parse_multiplicative_expr();

        while (this.at().value == "+" || this.at().value == "-") {
            const operator = this.next().value;
            const right = this.parse_multiplicative_expr();
            left = {
                kind: "BinaryExpr",
                left,
                right,
                operator
            } as BinaryExpr
        }
        return left;
    }

    private parse_multiplicative_expr(): Expr {
        let left = this.parse_call_member_expr();

        while (this.at().value == "/" || this.at().value == "*" || this.at().value == "%") {
            const operator = this.next().value;
            const right = this.parse_call_member_expr();
            left = {
                kind: "BinaryExpr",
                left,
                right,
                operator
            } as BinaryExpr
        }
        return left;
    }
    private parse_call_member_expr(): Expr {
        const member = this.parse_member_expr()

        if (this.at().type == TokenType.OpenParen) {
            return this.parse_call_expr(member)
        }

        return member
    }

    private parse_call_expr(caller: Expr): Expr {
        let call_expr: Expr = {
            kind: "CallExpr",
            caller,
            args: this.parse_args()
        } as CallExpr

        if (this.at().type == TokenType.OpenParen) {
            call_expr = this.parse_call_expr(call_expr)
        }

        return call_expr
    }

    private parse_args(): Expr[] {
        this.expect(TokenType.OpenParen, `Falta el (`)
        const args = this.at().type == TokenType.CloseParen ? [] : this.parse_arguments_list()

        this.expect(TokenType.CloseParen, `Falta el )`)
        return args
    }

    private parse_arguments_list(): Expr[] {
        const args = [this.parse_assignment_expr()]

        while (this.at().type == TokenType.Comma && this.next()) {
            args.push(this.parse_assignment_expr())
        }

        return args
    }

    private parse_member_expr(): Expr {
        let object = this.parse_primary_expr()

        while (this.at().type == TokenType.Dot || this.at().type == TokenType.OpenBracket) {
            const operator = this.next()
            let property: Expr
            let computed: boolean

            if (operator.type == TokenType.Dot) {
                computed = false
                property = this.parse_primary_expr()

                if (property.kind !== "Identifier") {
                    throw `No se puede usar . sin el lado derecho siendo un identificador`
                }
            } else {
                computed = true
                property = this.parse_expr()
                this.expect(TokenType.CloseBrace, `Falta el }`)
            }
            object = { kind: "MemberExpr", object, property, computed } as MemberExpr
        }
        return object
    }

    private parse_primary_expr(): Expr {
        const tk = this.at().type

        switch (tk) {
            case TokenType.Identifier:
                return { kind: "Identifier", symbol: this.next().value } as Identifier

            case TokenType.Number:
                return { kind: "NumericLiteral", value: parseFloat(this.next().value) } as NumericLiteral

            case TokenType.OpenParen: {
                this.next(); // eat the opening paren
                const value = this.parse_expr();
                this.expect(
                    TokenType.CloseParen,
                    "Carácter inesperado encontrado dentro del paréntesis."
                ); // closing paren
                return value;
            }

            case TokenType.String:
                return { kind: "StringLiteral", value: this.next().value } as StringLiteral;


            default:
                console.error(`Carácter inesperado encontrado "${this.at().value}"`)
                Deno.exit(1);
        }
    }
}