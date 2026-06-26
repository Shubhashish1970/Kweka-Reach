import React, { useState, useEffect, useMemo } from 'react';
import { Check, X, Users as UsersIcon, Loader2 } from 'lucide-react';
import { usersAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useMasterLanguages } from '../../hooks/useMasterLanguages';

interface Agent {
  _id: string;
  name: string;
  email: string;
  languageCapabilities: string[];
  isActive: boolean;
}

const AgentLanguageMatrix: React.FC = () => {
  const { showError } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const agentLanguages = useMemo(
    () => agents.flatMap((agent) => agent.languageCapabilities || []),
    [agents]
  );
  const { languages: availableLanguages, isLoading: isLoadingLanguages } = useMasterLanguages(agentLanguages);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setIsLoading(true);
    try {
      const response: any = await usersAPI.getUsers({
        role: 'cc_agent',
        isActive: true,
      });

      if (response.success && response.data) {
        setAgents(response.data.users || []);
      }
    } catch (error: any) {
      showError(error.message || 'Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || isLoadingLanguages) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="animate-spin text-lime-600 mx-auto mb-4" size={32} />
          <p className="text-slate-600 font-medium">Loading language matrix...</p>
        </div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
        <UsersIcon size={48} className="mx-auto text-slate-300 mb-4" />
        <p className="text-slate-600 font-medium text-lg mb-2">No CC Agents found</p>
        <p className="text-sm text-slate-500">Create CC Agents to see language capabilities</p>
      </div>
    );
  }

  // Calculate language coverage
  const languageCoverage = availableLanguages.map((lang) => {
    const agentsWithLang = agents.filter((agent) => agent.languageCapabilities.includes(lang));
    return {
      language: lang,
      agentCount: agentsWithLang.length,
      agents: agentsWithLang,
      coverage: agents.length > 0 ? (agentsWithLang.length / agents.length) * 100 : 0,
    };
  });

  const languagesWithoutAgents = languageCoverage.filter((cov) => cov.agentCount === 0);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-2xl font-black text-slate-900">{agents.length}</div>
          <div className="text-sm text-slate-600 font-medium mt-1">Total Agents</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-2xl font-black text-green-700">
            {availableLanguages.length - languagesWithoutAgents.length}
          </div>
          <div className="text-sm text-slate-600 font-medium mt-1">Languages Covered</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-2xl font-black text-red-700">{languagesWithoutAgents.length}</div>
          <div className="text-sm text-slate-600 font-medium mt-1">Languages Uncovered</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-2xl font-black text-blue-700">
            {agents.reduce((sum, agent) => sum + agent.languageCapabilities.length, 0)}
          </div>
          <div className="text-sm text-slate-600 font-medium mt-1">Total Language Assignments</div>
        </div>
      </div>

      {/* Language Coverage Alerts */}
      {languagesWithoutAgents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <X className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold text-red-900 mb-2">Languages Without Agent Coverage</p>
              <div className="flex flex-wrap gap-2">
                {languagesWithoutAgents.map((cov) => (
                  <span
                    key={cov.language}
                    className="px-3 py-1 bg-red-100 text-red-800 text-sm font-medium rounded-lg"
                  >
                    {cov.language}
                  </span>
                ))}
              </div>
              <p className="text-sm text-red-700 mt-2">
                Farmers speaking these languages may not receive calls until agents are assigned.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider sticky left-0 bg-slate-50 z-10">
                  Agent
                </th>
                {availableLanguages.map((lang) => (
                  <th
                    key={lang}
                    className="px-4 py-4 text-center text-xs font-black text-slate-700 uppercase tracking-wider min-w-[100px]"
                  >
                    {lang}
                  </th>
                ))}
                <th className="px-6 py-4 text-center text-xs font-black text-slate-700 uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {agents.map((agent) => (
                <tr key={agent._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 sticky left-0 bg-white z-10">
                    <div>
                      <div className="font-bold text-slate-900">{agent.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{agent.email}</div>
                    </div>
                  </td>
                  {availableLanguages.map((lang) => {
                    const hasLanguage = agent.languageCapabilities.includes(lang);
                    return (
                      <td key={lang} className="px-4 py-4 text-center">
                        {hasLanguage ? (
                          <div className="flex items-center justify-center">
                            <Check
                              size={20}
                              className="text-green-700 bg-green-100 rounded-full p-1"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center">
                            <X size={20} className="text-slate-300" />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center justify-center w-8 h-8 bg-green-100 text-green-800 text-sm font-bold rounded-full">
                      {agent.languageCapabilities.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-300">
              <tr>
                <td className="px-6 py-4 font-bold text-slate-900 sticky left-0 bg-slate-50 z-10">
                  Coverage
                </td>
                {languageCoverage.map((cov) => (
                  <td key={cov.language} className="px-4 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-sm font-bold text-slate-900">{cov.agentCount}</span>
                      <div className="w-full bg-slate-200 rounded-full h-2 max-w-[60px]">
                        <div
                          className={`h-2 rounded-full ${
                            cov.agentCount > 0 ? 'bg-green-600' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(cov.coverage, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </td>
                ))}
                <td className="px-6 py-4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Language Coverage Details */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-lg font-black text-slate-900 mb-4">Language Coverage Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {languageCoverage.map((cov) => (
            <div
              key={cov.language}
              className={`p-4 rounded-xl border-2 ${
                cov.agentCount > 0
                  ? 'border-green-200 bg-green-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900">{cov.language}</span>
                {cov.agentCount > 0 ? (
                  <Check className="text-green-700" size={20} />
                ) : (
                  <X className="text-red-700" size={20} />
                )}
              </div>
              <div className="text-2xl font-black text-slate-900 mb-1">
                {cov.agentCount}
              </div>
              <div className="text-xs text-slate-600 font-medium">
                {cov.agentCount === 1 ? 'Agent' : 'Agents'} capable
              </div>
              {cov.agents.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <div className="text-xs text-slate-600 font-medium mb-1">Agents:</div>
                  <div className="space-y-1">
                    {cov.agents.slice(0, 3).map((agent) => (
                      <div key={agent._id} className="text-xs text-slate-700 truncate">
                        {agent.name}
                      </div>
                    ))}
                    {cov.agents.length > 3 && (
                      <div className="text-xs text-slate-500">
                        +{cov.agents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentLanguageMatrix;
