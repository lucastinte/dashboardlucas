import React, { createContext, useContext, useState, useEffect } from 'react';

export interface CartItem {
  id: string; // ID específico del item o de la variante
  productName: string;
  storeTitle: string;
  variantName?: string;
  imageUrl?: string;
  price: number;
  quantity: number;
  maxQuantity: number; // Stock límite real
  location?: string;
  condition: string;
  storeGroup?: string;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>, quantity?: number) => boolean;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => boolean;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart debe usarse dentro de un CartProvider');
  }
  return context;
};

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('lucas_shop_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('lucas_shop_cart', JSON.stringify(cart));
    } catch (e) {
      console.error('Error al guardar el carrito en localStorage', e);
    }
  }, [cart]);

  const addToCart = (item: Omit<CartItem, 'quantity'>, quantityToAdd = 1): boolean => {
    let success = false;
    setCart((prev) => {
      const existingIdx = prev.findIndex((i) => i.id === item.id);
      if (existingIdx > -1) {
        const existingItem = prev[existingIdx];
        const nextQty = existingItem.quantity + quantityToAdd;
        const updated = [...prev];
        if (nextQty <= item.maxQuantity) {
          updated[existingIdx] = { ...existingItem, quantity: nextQty };
        } else {
          // Si supera el stock, se ajusta al máximo posible
          updated[existingIdx] = { ...existingItem, quantity: item.maxQuantity };
          alert(`Solo quedan ${item.maxQuantity} unidades disponibles de este producto.`);
        }
        success = true;
        return updated;
      } else {
        if (quantityToAdd <= item.maxQuantity) {
          success = true;
          return [...prev, { ...item, quantity: quantityToAdd }];
        } else {
          alert(`No puedes agregar más del stock disponible (${item.maxQuantity} unidades).`);
          return prev;
        }
      }
    });
    // React procesa el callback de setCart de forma síncrona en el mismo tick
    // cuando se llama fuera de eventos asíncronos, por lo que success ya tiene el valor correcto.
    return success;
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQuantity = (id: string, newQty: number): boolean => {
    if (newQty <= 0) {
      removeFromCart(id);
      return true;
    }
    let success = false;
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx > -1) {
        const item = prev[idx];
        if (newQty <= item.maxQuantity) {
          const updated = [...prev];
          updated[idx] = { ...item, quantity: newQty };
          success = true;
          return updated;
        } else {
          alert(`Solo hay ${item.maxQuantity} unidades disponibles de este producto.`);
          return prev;
        }
      }
      return prev;
    });
    return success;
  };

  const clearCart = () => {
    setCart([]);
  };

  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        totalItems,
        totalPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};
