import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import TodayPage from './pages/TodayPage';
import MatchDetailPage from './pages/MatchDetailPage';
import ProfilePage from './pages/ProfilePage';
import RulesPage from './pages/RulesPage';
import AdminPage from './pages/AdminPage';
import { AdminRouteGuard } from './components/AdminRouteGuard';
import TeamsPage from './pages/TeamsPage/TeamsPage';
import TeamDetailPage from './pages/TeamDetailPage/TeamDetailPage';
import TeamByNamePage from './pages/TeamByNamePage/TeamByNamePage';
import StatsPage from './pages/StatsPage/StatsPage';
import FootballStatsPage from './pages/FootballStatsPage/FootballStatsPage';
import BeidanPage from './pages/BeidanPage/BeidanPage';
import BasketballPage from './pages/BasketballPage/BasketballPage';
import BasketballDetailPage from './pages/BasketballDetailPage/BasketballDetailPage';
import BasketballStatsPage from './pages/BasketballStatsPage/BasketballStatsPage';
import BasketballSchedulePage from './pages/BasketballSchedulePage/BasketballSchedulePage';
import BasketballBacktestPage from './pages/BasketballBacktestPage/BasketballBacktestPage';
import BasketballReviewPage from './pages/BasketballReviewPage/BasketballReviewPage';
import PerformancePage from './pages/PerformancePage/PerformancePage';

import HelpPage from './pages/HelpPage/HelpPage';
import SupportPage from './pages/SupportPage/SupportPage';
import AboutPage from './pages/AboutPage/AboutPage';
import NotFound from './pages/NotFound/NotFound';
import BrandPage from './pages/BrandPage/BrandPage';
import InjuriesPage from './pages/InjuriesPage/InjuriesPage';

const RoutesComponent = () => {
  return (
    <ThemeProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TodayPage />} />
        <Route path="match/:id" element={<MatchDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="admin" element={<AdminRouteGuard><AdminPage /></AdminRouteGuard>} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:id" element={<TeamDetailPage />} />
        <Route path="teams/by-name/:name" element={<TeamByNamePage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="stats/football" element={<FootballStatsPage />} />
        <Route path="beidan" element={<BeidanPage />} />
        <Route path="basketball" element={<BasketballPage />} />
        <Route path="basketball/detail/:id" element={<BasketballDetailPage />} />
        <Route path="basketball/schedule" element={<BasketballSchedulePage />} />
        <Route path="basketball/stats" element={<BasketballStatsPage />} />
        <Route path="basketball/backtest" element={<BasketballBacktestPage />} />
        <Route path="basketball/review" element={<BasketballReviewPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="performance/football" element={<PerformancePage />} />
        <Route path="parlay" element={<Navigate to="/" replace />} />
        <Route path="basketball/parlay" element={<Navigate to="/basketball" replace />} />

        <Route path="help" element={<HelpPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="injuries" element={<InjuriesPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="brand" element={<BrandPage />} />
    </Routes>
    </ThemeProvider>
  );
};

export default RoutesComponent;
