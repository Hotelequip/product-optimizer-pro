import { useState } from "react";
import { useWooStores, useCreateWooStore, useUpdateWooStore, useDeleteWooStore, WooStore } from "@/hooks/useWooStores";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Store, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function WooCommerceStores() {
  const { data: stores = [], isLoading } = useWooStores();
  const createStore = useCreateWooStore();
  const updateStore = useUpdateWooStore();
  const deleteStore = useDeleteWooStore();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WooStore | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await deleteStore.mutateAsync(id);
      toast({ title: "Loja removida com sucesso" });
    } catch {
      toast({ title: "Erro ao remover loja", variant: "destructive" });
    }
  };

  const handleToggleActive = async (store: WooStore) => {
    try {
      await updateStore.mutateAsync({ id: store.id, is_active: !store.is_active });
    } catch {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lojas WooCommerce</h1>
          <p className="text-muted-foreground mt-1">Gerencie suas conexões com lojas WooCommerce</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Nova Loja</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Loja" : "Nova Loja WooCommerce"}</DialogTitle>
            </DialogHeader>
            <StoreForm
              store={editing}
              onSubmit={async (data) => {
                try {
                  if (editing) {
                    await updateStore.mutateAsync({ id: editing.id, ...data });
                    toast({ title: "Loja atualizada!" });
                  } else {
                    await createStore.mutateAsync(data);
                    toast({ title: "Loja adicionada!" });
                  }
                  setDialogOpen(false);
                  setEditing(null);
                } catch {
                  toast({ title: "Erro ao salvar loja", variant: "destructive" });
                }
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Store className="h-5 w-5" />
            Lojas Configuradas
          </CardTitle>
          <CardDescription>Configure a URL e credenciais da API REST de cada loja WooCommerce</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : stores.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Store className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhuma loja configurada. Adicione sua primeira loja WooCommerce.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>URL da Loja</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">{store.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{store.store_url}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={store.is_active}
                          onCheckedChange={() => handleToggleActive(store)}
                        />
                        <Badge variant={store.is_active ? "default" : "secondary"}>
                          {store.is_active ? "Ativa" : "Inativa"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(store); setDialogOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(store.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StoreForm({
  store,
  onSubmit,
}: {
  store: WooStore | null;
  onSubmit: (data: { name: string; store_url: string; consumer_key: string; consumer_secret: string }) => Promise<void>;
}) {
  const [name, setName] = useState(store?.name || "");
  const [storeUrl, setStoreUrl] = useState(store?.store_url || "");
  const [consumerKey, setConsumerKey] = useState(store?.consumer_key || "");
  const [consumerSecret, setConsumerSecret] = useState(store?.consumer_secret || "");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit({ name, store_url: storeUrl, consumer_key: consumerKey, consumer_secret: consumerSecret });
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome da Loja</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Minha Loja Principal" required />
      </div>
      <div className="space-y-2">
        <Label>URL da Loja</Label>
        <Input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://minhaloja.com.br" required />
      </div>
      <div className="space-y-2">
        <Label>Consumer Key</Label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={consumerKey}
            onChange={(e) => setConsumerKey(e.target.value)}
            placeholder="ck_..."
            required
          />
          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Consumer Secret</Label>
        <div className="relative">
          <Input
            type={showSecret ? "text" : "password"}
            value={consumerSecret}
            onChange={(e) => setConsumerSecret(e.target.value)}
            placeholder="cs_..."
            required
          />
          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowSecret(!showSecret)}>
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Salvando..." : store ? "Atualizar" : "Adicionar Loja"}
      </Button>
    </form>
  );
}
