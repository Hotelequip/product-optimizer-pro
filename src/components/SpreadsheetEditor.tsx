import { useState } from "react";
import { Product, useUpdateProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wand2, Image as ImageIcon, Loader2, Check, X, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface EditableCell {
  productId: string;
  field: string;
}

export function SpreadsheetEditor({ products }: { products: Product[] }) {
  const updateProduct = useUpdateProduct();
  const { data: categories = [] } = useCategories();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<EditableCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);

  const startEdit = (productId: string, field: string, currentValue: any) => {
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { productId, field } = editingCell;
    let value: any = editValue;

    if (field === "cost" || field === "price") value = parseFloat(editValue) || 0;
    if (field === "stock") value = parseInt(editValue) || 0;

    try {
      await updateProduct.mutateAsync({ id: productId, [field]: value });
    } catch {}
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const enrichProduct = async (product: Product) => {
    setEnrichingId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "enrich", product: { name: product.name, description: product.description, cost: product.cost, price: product.price } },
      });
      if (error) throw error;
      if (data.success && data.enriched?.description) {
        await updateProduct.mutateAsync({ id: product.id, description: data.enriched.description });
        toast({ title: "Produto enriquecido com IA!" });
      } else {
        toast({ title: "Erro ao enriquecer", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setEnrichingId(null);
  };

  const generateImage = async (product: Product) => {
    setGeneratingImageId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "generate_image", product: { name: product.name, description: product.description } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        // Upload base64 image to storage
        const base64Data = data.image_url.split(",")[1];
        const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const fileName = `${product.id}-${Date.now()}.png`;
        
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(fileName, byteArray, { contentType: "image/png", upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
        await updateProduct.mutateAsync({ id: product.id, image_url: urlData.publicUrl });
        toast({ title: "Imagem gerada com IA!" });
      } else {
        toast({ title: "Erro ao gerar imagem", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setGeneratingImageId(null);
  };

  const isEditing = (productId: string, field: string) =>
    editingCell?.productId === productId && editingCell?.field === field;

  const renderCell = (product: Product, field: keyof Product, width: string) => {
    if (isEditing(product.id, field)) {
      return (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveEdit}
            className="h-7 text-xs"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={saveEdit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={cancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    const value = product[field];
    const displayValue = field === "cost" || field === "price"
      ? `R$ ${Number(value).toFixed(2)}`
      : String(value ?? "-");

    return (
      <div
        className="cursor-pointer hover:bg-accent/50 px-2 py-1 rounded text-xs truncate"
        onDoubleClick={() => startEdit(product.id, field, value)}
        title="Duplo clique para editar"
      >
        {displayValue}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-10">Img</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground min-w-[180px]">Nome</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground min-w-[200px]">Descrição</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-24">Custo</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-24">Preço</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-20">Estoque</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-24">Status</th>
            <th className="text-left p-2 text-xs font-medium text-muted-foreground w-28">IA</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const margin = product.cost > 0 ? ((product.price - product.cost) / product.cost) * 100 : 0;
            return (
              <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-1">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                      <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </td>
                <td className="p-1">{renderCell(product, "name", "180px")}</td>
                <td className="p-1">
                  <div
                    className="cursor-pointer hover:bg-accent/50 px-2 py-1 rounded text-xs truncate max-w-[250px]"
                    onDoubleClick={() => startEdit(product.id, "description", product.description)}
                    title="Duplo clique para editar"
                  >
                    {product.description || <span className="text-muted-foreground italic">Sem descrição</span>}
                  </div>
                  {isEditing(product.id, "description") && (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={saveEdit}
                        className="h-7 text-xs"
                      />
                    </div>
                  )}
                </td>
                <td className="p-1">{renderCell(product, "cost", "90px")}</td>
                <td className="p-1">{renderCell(product, "price", "90px")}</td>
                <td className="p-1">{renderCell(product, "stock", "70px")}</td>
                <td className="p-1">
                  {isEditing(product.id, "status") ? (
                    <Select value={editValue} onValueChange={(v) => { setEditValue(v); updateProduct.mutateAsync({ id: product.id, status: v as any }); setEditingCell(null); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                        <SelectItem value="draft">Rascunho</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div onDoubleClick={() => startEdit(product.id, "status", product.status)} className="cursor-pointer">
                      <Badge variant={product.status === "active" ? "default" : product.status === "inactive" ? "secondary" : "outline"} className="text-[10px]">
                        {product.status === "active" ? "Ativo" : product.status === "inactive" ? "Inativo" : "Rascunho"}
                      </Badge>
                    </div>
                  )}
                </td>
                <td className="p-1">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => enrichProduct(product)}
                      disabled={enrichingId === product.id}
                      title="Enriquecer com IA"
                    >
                      {enrichingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => generateImage(product)}
                      disabled={generatingImageId === product.id}
                      title="Gerar imagem com IA"
                    >
                      {generatingImageId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
