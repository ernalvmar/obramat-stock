import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Types
import {
    User,
    Article,
    InboundMovement,
    ManualConsumption,
    StockAdjustment,
    OperationalLoad,
    MonthClosing,
    InventoryItem,
    ArticleStatus
} from './types';

// Data
import { INITIAL_USERS } from './data/mockData';

// Utils
import { getCurrentMonth, generateId } from './utils/helpers';

// Components
import { LoginView } from './components/auth/LoginView';
import { Sidebar, TabType } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardView } from './components/views/DashboardView';
import { ArticlesMasterView } from './components/views/ArticlesMasterView';
import { OperationalLoadsView } from './components/views/OperationalLoadsView';
import { InboundForm } from './components/views/InboundForm';
import { ManualConsumptionForm } from './components/views/ManualConsumptionForm';
import { MonthClosingView } from './components/views/MonthClosingView';
import { BillingStagingView } from './components/views/BillingStagingView';
import { MovementHistoryView } from './components/views/MovementHistoryView';
import { Toast, NotificationType } from './components/ui/Toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const App: React.FC = () => {
    // persistent notifications state
    const [notifications, setNotifications] = useState<{ id: string; message: string; type: NotificationType }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const notify = (message: string, type: NotificationType = 'success') => {
        const id = generateId();
        setNotifications(prev => [...prev, { id, message, type }]);
    };

    const removeNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    // Auth state
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    // Navigation
    const [activeTab, setActiveTab] = useState<TabType>('dashboard');
    const [editingSku, setEditingSku] = useState<string | null>(null);
    const [loadsFilter, setLoadsFilter] = useState<'ALL' | 'DUPLICATES'>('ALL');

    // Remote State (from Neon)
    const [articles, setArticles] = useState<Article[]>([]);
    const [movements, setMovements] = useState<any[]>([]);
    const [loads, setLoads] = useState<OperationalLoad[]>([]);
    const [closings, setClosings] = useState<MonthClosing[]>([]);
    const [billingOverrides, setBillingOverrides] = useState<Record<string, number>>({});

    // Fetch data from API
    const fetchData = async () => {
        try {
            setIsLoading(true);
            const [artRes, movRes, loadRes] = await Promise.all([
                fetch(`${API_URL}/api/articles`).then(res => res.json()),
                fetch(`${API_URL}/api/movements`).then(res => res.json()),
                fetch(`${API_URL}/api/loads`).then(res => res.json())
            ]);

            setArticles(artRes);
            setMovements(movRes);

            // Transform backend loads to frontend format
            const transformedLoads = loadRes.map((l: any) => ({
                load_uid: l.ref_carga,
                ref_carga: l.ref_carga,
                precinto: l.matricula, // Using matricula as precinto for view if not separate
                flete: l.equipo,
                date: l.fecha.split('T')[0],
                consumptions: typeof l.consumos_json === 'string' ? JSON.parse(l.consumos_json) : (l.consumos_json || {}),
                duplicado: false,
                modificada: false,
                original_fingerprint: ''
            }));
            setLoads(transformedLoads);
        } catch (err) {
            notify('Error al conectar con el servidor. Verifica que el backend esté corriendo.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (currentUser) {
            fetchData();
        }
    }, [currentUser]);

    // Computed: Inventory Status
    const inventoryStatus: InventoryItem[] = useMemo(() => {
        return articles.map(art => {
            const artMovements = movements.filter(m => m.sku === art.sku);

            const totalInbound = artMovements
                .filter(m => m.tipo === 'ENTRADA')
                .reduce((sum, m) => sum + m.cantidad, 0);

            const totalOutbound = artMovements
                .filter(m => m.tipo === 'SALIDA')
                .reduce((sum, m) => sum + m.cantidad, 0);

            const stockActual = art.stock_inicial + totalInbound - totalOutbound;

            // Simple status logic
            let situacion: ArticleStatus = 'Con stock';
            if (stockActual <= 0) situacion = 'Sin stock';
            else if (stockActual <= art.stock_seguridad) situacion = 'Pedir a proveedor';

            return {
                ...art,
                stockActual,
                situacion,
                totalInbound,
                totalManualOut: 0, // Placeholder
                totalLoadOut: 0, // Placeholder
                avgWeeklyConsumption: 0,
                suggestedOrder: 0,
                targetStock: 0
            };
        });
    }, [articles, movements]);

    // Actions (To be converted to API calls)
    const handleSaveArticle = async (article: Article, isEdit: boolean) => {
        try {
            const res = await fetch(`${API_URL}/api/articles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(article)
            });
            const data = await res.json();
            if (isEdit) {
                setArticles(prev => prev.map(a => a.sku === data.sku ? data : a));
            } else {
                setArticles(prev => [...prev, data]);
            }
            notify(`Artículo ${data.nombre} guardado correctamente.`);
        } catch (e) {
            notify('Error al guardar el artículo.', 'error');
        }
    };

    const handleSaveInbound = async (data: any) => {
        try {
            const movement = {
                sku: data.sku,
                tipo: 'ENTRADA',
                cantidad: data.quantity,
                motivo: `${data.type}: ${data.proveedor || ''} ${data.albaran || ''}`.trim(),
                usuario: currentUser?.name,
                periodo: data.date.slice(0, 7)
            };

            const res = await fetch(`${API_URL}/api/movements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(movement)
            });

            if (!res.ok) throw new Error();

            notify(`Entrada registrada: ${data.quantity} un. de ${data.sku}`);
            fetchData(); // Refresh all state
            setActiveTab('dashboard');
        } catch (e) {
            notify('Error al registrar la entrada.', 'error');
        }
    };

    const handleSaveManualConsumption = async (data: any) => {
        try {
            const movement = {
                sku: data.sku,
                tipo: 'SALIDA',
                cantidad: data.quantity,
                motivo: data.reason,
                usuario: currentUser?.name,
                periodo: data.date.slice(0, 7)
            };

            const res = await fetch(`${API_URL}/api/movements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(movement)
            });

            if (!res.ok) throw new Error();

            notify(`Salida registrada: ${data.quantity} un. de ${data.sku}`);
            fetchData();
            setActiveTab('dashboard');
        } catch (e) {
            notify('Error al registrar el consumo.', 'error');
        }
    };

    const handleRegularize = async (adjustment: any) => {
        try {
            const movement = {
                sku: adjustment.sku,
                tipo: adjustment.delta > 0 ? 'ENTRADA' : 'SALIDA',
                cantidad: Math.abs(adjustment.delta),
                motivo: `Regularización: ${adjustment.reason}`,
                usuario: currentUser?.name,
                periodo: adjustment.date.slice(0, 7)
            };

            const res = await fetch(`${API_URL}/api/movements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(movement)
            });

            if (!res.ok) throw new Error();

            notify(`Ajuste de stock realizado para ${adjustment.sku}`);
            fetchData();
        } catch (e) {
            notify('Error al regularizar stock.', 'error');
        }
    };

    const handleUpdateBillingOverride = (id: string, qty: number) => {
        setBillingOverrides(prev => ({ ...prev, [id]: qty }));
    };

    if (!currentUser) {
        return <LoginView onLogin={setCurrentUser} />;
    }

    if (isLoading) {
        return <div className="h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold">Cargando datos de Neon...</div>;
    }

    const currentMonth = getCurrentMonth();
    const isMonthOpen = true; // Temporary

    return (
        <div className="flex h-screen bg-gray-100 text-slate-900">
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                currentUser={currentUser}
                onLogout={() => setCurrentUser(null)}
                hasLoadAlerts={false}
            />

            <main className="flex-1 overflow-auto">
                <Header
                    activeTab={activeTab}
                    currentMonth={currentMonth}
                    isMonthOpen={isMonthOpen}
                />

                <div className="p-8">
                    {activeTab === 'dashboard' && <DashboardView inventory={inventoryStatus.filter(a => a.activo)} />}

                    {activeTab === 'master' && (
                        <ArticlesMasterView
                            inventory={inventoryStatus}
                            onSave={handleSaveArticle}
                            onRegularize={handleRegularize}
                            onToggleStatus={(sku) => {
                                const art = articles.find(a => a.sku === sku);
                                if (art) handleSaveArticle({ ...art, activo: !art.activo }, true);
                            }}
                            deepLinkSku={editingSku}
                            clearDeepLink={() => setEditingSku(null)}
                            currentUser={currentUser}
                        />
                    )}

                    {activeTab === 'inbound' && (
                        <InboundForm
                            articles={articles.filter(a => a.activo)}
                            onSubmit={handleSaveInbound}
                            notify={notify}
                            isMonthOpen={isMonthOpen}
                            onNavigateMaster={() => setActiveTab('master')}
                        />
                    )}

                    {activeTab === 'loads' && (
                        <OperationalLoadsView
                            articles={articles}
                            loads={loads}
                            filterMode={loadsFilter}
                            setFilterMode={setLoadsFilter}
                            isMonthOpen={isMonthOpen}
                            onArticleClick={(sku) => {
                                setEditingSku(sku);
                                setActiveTab('master');
                            }}
                        />
                    )}

                    {activeTab === 'manual' && (
                        <ManualConsumptionForm
                            articles={inventoryStatus.filter(a => a.activo)}
                            onSubmit={handleSaveManualConsumption}
                            notify={notify}
                            isMonthOpen={isMonthOpen}
                        />
                    )}

                    {activeTab === 'history' && (
                        <MovementHistoryView
                            articles={articles}
                            inbounds={movements.filter(m => m.tipo === 'ENTRADA' && !m.motivo.includes('Regularización'))}
                            manualConsumptions={movements.filter(m => m.tipo === 'SALIDA' && !m.ref_operacion && !m.motivo.includes('Regularización'))}
                            loads={loads}
                            adjustments={movements.filter(m => m.motivo.includes('Regularización'))}
                        />
                    )}

                    {activeTab === 'billing' && (
                        <BillingStagingView
                            loads={loads}
                            currentMonth={currentMonth}
                            articles={articles}
                            closings={closings}
                            billingOverrides={billingOverrides}
                            onUpdateOverride={handleUpdateBillingOverride}
                            notify={notify}
                            currentUser={currentUser}
                        />
                    )}

                    {activeTab === 'closings' && (
                        <MonthClosingView
                            currentMonth={currentMonth}
                            loads={loads}
                            isMonthOpen={isMonthOpen}
                            setClosings={setClosings}
                            onJumpToDuplicates={() => {
                                setLoadsFilter('DUPLICATES');
                                setActiveTab('loads');
                            }}
                        />
                    )}
                </div>
                <Toast notifications={notifications} removeNotification={removeNotification} />
            </main>
        </div>
    );
};

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);

export default App;
