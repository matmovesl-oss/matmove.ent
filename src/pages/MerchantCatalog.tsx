import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props = {
  profile: { id: string };
};

const field =
  'w-full rounded-xl border border-slate-300 bg-white p-3';

const button =
  'rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white disabled:opacity-50';

export function MerchantCatalog({ profile }: Props) {
  const [tab, setTab] = useState<'products' | 'orders'>('products');
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('232');
  const [image, setImage] = useState('');

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [catalog, incoming] = await Promise.all([
      supabase
        .from('products')
        .select('id,name,price,description,image_url,whatsapp_number')
        .eq('merchant_id', profile.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('app_orders')
        .select('id,product_name,price,status,created_at')
        .eq('merchant_id', profile.id)
        .order('created_at', { ascending: false })
    ]);

    if (catalog.error || incoming.error) {
      setError(
        catalog.error?.message ||
        incoming.error?.message ||
        'Unable to load your catalog.'
      );
      return;
    }

    setProducts(catalog.data || []);
    setOrders(incoming.data || []);
  }, [profile.id]);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const upload = async (file?: File) => {
    if (!file) return;

    setError('');
    setMessage('');

    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };

    if (!extensions[file.type] || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image no larger than 5 MB.');
      return;
    }

    setUploading(true);

    try {
      const path =
        `${profile.id}-${crypto.randomUUID()}.${extensions[file.type]}`;

      const result = await supabase.storage
        .from('product_images')
        .upload(path, file, {
          contentType: file.type,
          upsert: false
        });

      if (result.error) throw result.error;

      const { data } = supabase.storage
        .from('product_images')
        .getPublicUrl(path);

      setImage(data.publicUrl);
      setMessage('Image uploaded. Save the product to publish it.');
    } catch (err: any) {
      setError(err.message || 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();

    setError('');
    setMessage('');

    const amount = Number(price);

    if (
      !name.trim() ||
      name.trim().length > 200 ||
      !/^\d+(\.\d{1,2})?$/.test(price) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        'Enter a product name and a positive price with up to two decimal places.'
      );
      return;
    }

    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      setError(
        'Enter your full WhatsApp number with country code, for example 23290330362.'
      );
      return;
    }

    if (!image) {
      setError('Upload one product image first.');
      return;
    }

    setBusy(true);

    try {
      const result = await supabase.from('products').insert({
        merchant_id: profile.id,
        name: name.trim(),
        price: amount,
        description: description.trim(),
        image_url: image,
        whatsapp_number: `+${phone}`
      });

      if (result.error) throw result.error;

      setName('');
      setPrice('');
      setDescription('');
      setImage('');

      setMessage('Product published successfully.');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Product could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .eq('merchant_id', profile.id)
        .select('id');

      if (result.error) throw result.error;

      if (!result.data?.length) {
        throw new Error('Product could not be deleted.');
      }

      setDeleteId(null);
      setMessage('Product deleted.');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <h1 className="text-3xl font-bold text-slate-900">
        Inventory & Orders
      </h1>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTab('products')} className={button}>
          My Products
        </button>

        <button onClick={() => setTab('orders')} className={button}>
          Orders ({orders.length})
        </button>

        <button
          onClick={() => {
            setError('');
            void refresh();
          }}
          className={field + ' !w-auto'}
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}

      {message && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-emerald-800"
        >
          {message}
        </p>
      )}

      {tab === 'products' ? (
        <>
          <form
            onSubmit={save}
            className="space-y-4 rounded-2xl border bg-white p-5"
          >
            <h2 className="text-xl font-bold">Add Product</h2>

            <label className="block">
              Product name
              <input
                required
                maxLength={200}
                value={name}
                onChange={e => setName(e.target.value)}
                className={field}
              />
            </label>

            <label className="block">
              Price (SLE)
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className={field}
              />
            </label>

            <label className="block">
              Description
              <textarea
                maxLength={2000}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={field}
              />
            </label>

            <label className="block">
              Merchant WhatsApp number
              <div className="flex overflow-hidden rounded-xl border border-slate-300">
                <span className="bg-slate-100 px-4 py-3 font-bold">+</span>
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={e =>
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))
                  }
                  className="min-w-0 flex-1 p-3"
                />
              </div>
            </label>

            <label className="block">
              Product image (one image, maximum 5 MB)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading || busy}
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  void upload(file);
                }}
                className={field}
              />
            </label>

            {uploading && <p role="status">Uploading image...</p>}

            {image && (
              <img
                src={image}
                alt="Product preview"
                className="h-48 w-full rounded-xl bg-slate-50 object-contain"
              />
            )}

            <button
              type="submit"
              disabled={busy || uploading}
              className={button}
            >
              {busy ? 'Saving...' : 'Save Product'}
            </button>
          </form>

          {!products.length && <p>No products listed yet.</p>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map(product => (
              <article
                key={product.id}
                className="overflow-hidden rounded-2xl border bg-white"
              >
                {product.image_url && (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-44 w-full object-cover"
                  />
                )}

                <div className="space-y-2 p-4">
                  <h2 className="text-lg font-bold">{product.name}</h2>

                  <p className="font-semibold">
                    SLE {Number(product.price).toFixed(2)}
                  </p>

                  <p className="break-words text-sm text-slate-600">
                    {product.description}
                  </p>

                  <p className="text-sm">
                    WhatsApp: {product.whatsapp_number || 'Not supplied'}
                  </p>

                  {deleteId === product.id ? (
                    <div className="flex gap-3">
                      <button
                        disabled={busy}
                        onClick={() => void remove(product.id)}
                        className="text-red-700"
                      >
                        Confirm delete
                      </button>

                      <button
                        disabled={busy}
                        onClick={() => setDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => setDeleteId(product.id)}
                      className="text-red-700"
                    >
                      Delete product
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {!orders.length && <p>No in-app orders received yet.</p>}

          {orders.map(order => (
            <article
              key={order.id}
              className="rounded-2xl border bg-white p-5"
            >
              <h2 className="text-lg font-bold">{order.product_name}</h2>

              <p>SLE {Number(order.price || 0).toFixed(2)}</p>

              <p>Order status: {order.status || 'pending'}</p>

              <p className="text-sm text-slate-500">
                {new Date(order.created_at).toLocaleString()}
              </p>

              <p className="break-all text-xs text-slate-500">
                Order reference: {order.id}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}