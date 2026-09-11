'use client';

import { createContext, useContext, useMemo, useState } from 'react';

interface CheckoutAddressContextValue {
  selectedAddressId: string | null; // null = registered shop address
  setSelectedAddressId: (id: string | null) => void;
}

const CheckoutAddressContext = createContext<CheckoutAddressContextValue>({
  selectedAddressId: null,
  setSelectedAddressId: () => {},
});

export function CheckoutAddressProvider({
  defaultAddressId,
  children,
}: {
  /** Preselected saved-address id (the default address), if one exists. */
  defaultAddressId: string | null;
  children: React.ReactNode;
}) {
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(defaultAddressId);
  const value = useMemo(() => ({ selectedAddressId, setSelectedAddressId }), [selectedAddressId]);
  return <CheckoutAddressContext.Provider value={value}>{children}</CheckoutAddressContext.Provider>;
}

export function useCheckoutAddress(): CheckoutAddressContextValue {
  return useContext(CheckoutAddressContext);
}
