

# Otimizador de Produtos E-commerce

## Visão Geral
Plataforma para gerenciar, analisar e otimizar produtos de e-commerce com gestão de catálogo, automação de preços e análise comparativa.

## Páginas e Funcionalidades

### 1. Autenticação (Login/Cadastro)
- Tela de login e registro com email/senha
- Perfil do usuário com nome e preferências
- Tabela de perfis no Supabase com trigger automático

### 2. Dashboard Principal
- Resumo de KPIs: total de produtos, margem média, produtos com preço desatualizado
- Gráficos de distribuição de preços e margens
- Alertas de produtos que precisam de atenção (estoque baixo, preço fora do mercado)

### 3. Gestão de Catálogo
- Listagem de produtos com busca e filtros (categoria, status, faixa de preço)
- Cadastro/edição de produtos: nome, descrição, categoria, custo, preço de venda, estoque, imagem
- Importação em lote (CSV)
- Status do produto (ativo, inativo, rascunho)

### 4. Automação de Preços
- Regras de precificação: markup sobre custo, margem mínima, arredondamento
- Simulador de preços: ajustar preços em lote por categoria com preview antes de aplicar
- Histórico de alterações de preço por produto

### 5. Comparação e Análise
- Tabela comparativa de produtos lado a lado (preço, custo, margem, estoque)
- Ranking de produtos por margem, volume de vendas estimado
- Identificação de oportunidades: produtos com margem abaixo da meta

## Backend (Supabase/Lovable Cloud)
- Tabelas: profiles, products, price_rules, price_history, categories
- RLS para isolamento por usuário
- Edge function para cálculos de precificação em lote

## Design
- Layout com sidebar de navegação
- Design limpo e profissional com cards e tabelas
- Responsivo para desktop e tablet
- Tema claro com cores neutras e acentos em azul

