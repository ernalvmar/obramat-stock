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
            setLoads(loadRes);
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
                            onRegularize={() => { }} // TODO
                            onToggleStatus={() => { }} // TODO
                            deepLinkSku={editingSku}
                            clearDeepLink={() => setEditingSku(null)}
                            currentUser={currentUser}
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

                    {/* Other tabs ignored for brevity in this sync step */}
                    {activeTab !== 'dashboard' && activeTab !== 'master' && activeTab !== 'billing' && (
                        <div className="bg-amber-50 p-6 rounded-xl border border-amber-200 text-amber-800">
                            Pestaña "{activeTab}" en mantenimiento por migración a base de datos real.
                        </div>
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
