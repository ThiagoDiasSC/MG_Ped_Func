const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos (HTML, CSS, JS) na mesma pasta do servidor
app.use(express.static(__dirname));

// Configuração de conexão direta com o Supabase usando seus parâmetros
const pool = new Pool({
    user: process.env.DB_USER || 'postgres.bhsqszzupdbzscnxskqd',
    host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || '230499@ScMeg@',
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false // Obrigatório para conexão segura SSL com o Supabase
    }
});

// Teste de conexão
pool.connect((err, client, release) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL no Supabase:', err.stack);
        return;
    }
    console.log('Conectado ao PostgreSQL no Supabase com sucesso!');
    release();
});

// 1. Rota para autenticação de Administradores na tabela MG_User
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ error: 'Informe o usuário/email e a senha.' });
    }

    try {
        const query = `
            SELECT "Id_User", "Email", "Nome_User" 
            FROM "MG_User" 
            WHERE ("Nome_User" = $1 OR "Email" = $1) AND "Senha_User" = $2
        `;
        const { rows } = await pool.query(query, [usuario.trim(), senha.trim()]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }

        res.json({
            message: 'Login realizado com sucesso!',
            user: rows[0]
        });
    } catch (err) {
        console.error('Erro ao autenticar usuário na tabela MG_User:', err.message);
        res.status(500).json({ error: 'Erro no servidor ao validar credenciais.' });
    }
});

// 2. Rota para filtrar pedidos por intervalo de data/hora no Painel Admin
app.get('/api/pedidos/filtro', async (req, res) => {
    const { inicio, fim } = req.query;

    if (!inicio || !fim) {
        return res.status(400).json({ error: 'Informe a data/hora inicial e final.' });
    }

    try {
        const query = `
            SELECT 
                "Id", 
                "Num_Ped", 
                "Nome_Func", 
                "Cod_Func", 
                "MG_Rev", 
                "Form_Pag", 
                "Cod_Prod", 
                "Tipo_Ped", 
                "QTD_Ped", 
                to_char("DT_Ped", 'DD/MM/YYYY HH24:MI:SS') AS "DT_Ped"
            FROM "MG_Pedido"
            WHERE "DT_Ped" BETWEEN $1::timestamp AND $2::timestamp
            ORDER BY "DT_Ped" ASC, "Num_Ped" ASC
        `;

        const { rows } = await pool.query(query, [inicio, fim]);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar pedidos filtrados:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. Rota para buscar os funcionários da tabela MG_Func
app.get('/api/funcionarios', async (req, res) => {
    try {
        const query = 'SELECT "Nome_Func" AS nome, "Cod_Func" AS fun_cod FROM "MG_Func" ORDER BY "Nome_Func" ASC';
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar funcionários na tabela MG_Func:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 4. Rota para buscar produtos da tabela MG_Produto
app.get('/api/produtos', async (req, res) => {
    try {
        let query = `
            SELECT 
                COALESCE("Desc_Prod", "desc_prod", "DESC_PROD") AS produto, 
                COALESCE("Cod_prod", "cod_prod", "COD_PROD") AS prod_cod, 
                COALESCE("QTD", "qtd") AS qtd_cx, 
                COALESCE("Val_Cx", "val_cx") AS val_cx, 
                COALESCE("Val_Uni", "val_uni") AS val_uni 
            FROM "MG_Produto"
        `;
        
        let rows;
        try {
            const result = await pool.query(query);
            rows = result.rows;
        } catch (e) {
            const fallbackResult = await pool.query('SELECT * FROM "MG_Produto"');
            rows = fallbackResult.rows.map(row => {
                const keys = Object.keys(row);
                const findKey = (name) => keys.find(k => k.toLowerCase() === name.toLowerCase());

                return {
                    produto: row[findKey('desc_prod')] || row[findKey('descricao')] || row[findKey('produto')] || '',
                    prod_cod: row[findKey('cod_prod')] || row[findKey('codigo')] || '',
                    qtd_cx: row[findKey('qtd')] || row[findKey('qtd_cx')] || '',
                    val_cx: row[findKey('val_cx')] || '',
                    val_uni: row[findKey('val_uni')] || ''
                };
            });
        }

        res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar produtos na tabela MG_Produto:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. Rota para cadastrar o lote na tabela MG_Pedido
app.post('/api/registros', async (req, res) => {
    const { itens } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Nenhum item enviado para o pedido.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Busca o próximo Num_Ped para o lote
        const numPedQuery = 'SELECT COALESCE(MAX("Num_Ped"), 0) + 1 AS proximo_num_ped FROM "MG_Pedido"';
        const numPedResult = await client.query(numPedQuery);
        const proximoNumPed = parseInt(numPedResult.rows[0].proximo_num_ped, 10);

        // Busca o próximo Id único
        const idQuery = 'SELECT COALESCE(MAX("Id"), 0) AS max_id FROM "MG_Pedido"';
        const idResult = await client.query(idQuery);
        let atualId = parseInt(idResult.rows[0].max_id, 10);

        const insertQuery = `
            INSERT INTO "MG_Pedido" (
                "Id", 
                "Nome_Func", 
                "Cod_Func", 
                "MG_Rev", 
                "Form_Pag", 
                "Cod_Prod", 
                "Tipo_Ped", 
                "QTD_Ped", 
                "Val_Ped", 
                "Num_Ped", 
                "DT_Ped"
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (NOW() AT TIME ZONE 'America/Sao_Paulo'))
        `;

        for (const item of itens) {
            atualId += 1;

            const codProdNum = parseInt(String(item.Cod_Prod || 0).replace(/\D/g, ''), 10) || 0;
            const qtdPedNum = parseInt(item.QTD_Ped || 1, 10);
            const valPedNum = parseFloat(String(item.Val_Ped || 0).replace(',', '.')) || 0;

            const values = [
                atualId,
                String(item.Nome_Func || ''),
                String(item.Cod_Func || ''),
                String(item.MG_Rev || ''),
                String(item.Form_Pag || ''),
                codProdNum,
                String(item.Tipo_Ped || ''),
                qtdPedNum,
                valPedNum,
                proximoNumPed
            ];

            await client.query(insertQuery, values);
        }

        await client.query('COMMIT');

        res.status(201).json({ 
            num_ped: proximoNumPed, 
            message: `Pedido nº ${proximoNumPed} gravado com sucesso com ${itens.length} item(ns)!` 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao salvar pedido na tabela MG_Pedido:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Rota principal para carregar o arquivo HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_2.html'));
});

// Porta dinâmica para servidores de nuvem (Render) ou 3000 localmente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} conectado ao Supabase`);
});