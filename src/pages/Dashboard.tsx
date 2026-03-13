import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProducts } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Package, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(222, 47%, 11%)", "hsl(210, 40%, 50%)", "hsl(215, 16%, 47%)", "hsl(210, 40%, 70%)", "hsl(214, 32%, 80%)"];

export default function Dashboard() {
  const { data: products = [] } = useProducts();
  const { data: categories = [] } = useCategories();

  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.status === "active").length;
  const avgMargin =
    totalProducts > 0
      ? products.reduce((acc, p) => acc + (p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0), 0) / totalProducts
      : 0;
  const lowStock = products.filter((p) => p.stock < 10 && p.status === "active").length;

  // Margin distribution
  const marginBuckets = [
    { range: "< 0%", count: 0 },
    { range: "0-20%", count: 0 },
    { range: "20-50%", count: 0 },
    { range: "50-100%", count: 0 },
    { range: "> 100%", count: 0 },
  ];
  products.forEach((p) => {
    const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
    if (margin < 0) marginBuckets[0].count++;
    else if (margin < 20) marginBuckets[1].count++;
    else if (margin < 50) marginBuckets[2].count++;
    else if (margin < 100) marginBuckets[3].count++;
    else marginBuckets[4].count++;
  });

  // Status pie
  const statusData = [
    { name: "Ativos", value: products.filter((p) => p.status === "active").length },
    { name: "Inativos", value: products.filter((p) => p.status === "inactive").length },
    { name: "Rascunho", value: products.filter((p) => p.status === "draft").length },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard title="Total de Produtos" value={totalProducts} icon={<Package className="h-5 w-5" />} />
        <KPICard title="Produtos Ativos" value={activeProducts} icon={<TrendingUp className="h-5 w-5" />} />
        <KPICard title="Margem Média" value={`${avgMargin.toFixed(1)}%`} icon={<DollarSign className="h-5 w-5" />} />
        <KPICard title="Estoque Baixo" value={lowStock} icon={<AlertTriangle className="h-5 w-5" />} variant={lowStock > 0 ? "warning" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribuição de Margens</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {totalProducts > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marginBuckets}>
                  <XAxis dataKey="range" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(222, 47%, 11%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status dos Produtos</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>
      </div>

      {lowStock > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">⚠️ Produtos com Estoque Baixo</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {products
                .filter((p) => p.stock < 10 && p.status === "active")
                .slice(0, 5)
                .map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.name}</span> — {p.stock} unidades
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPICard({ title, value, icon, variant = "default" }: { title: string; value: string | number; icon: React.ReactNode; variant?: "default" | "warning" }) {
  return (
    <Card className={variant === "warning" ? "border-destructive/50" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Adicione produtos para ver os gráficos</div>;
}
