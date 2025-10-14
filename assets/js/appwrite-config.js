// Renseignez ici les identifiants de votre projet Appwrite.
export const appwriteConfig = {
  endpoint: 'https://cloud.appwrite.io/v1',
  projectId: '68ee2f8900035e9a0405',
  databaseId: '68ee3a0d0008ef575ee1',
  ridesCollectionId: 'rides',
  proofsBucketId: '68ee56d3001a25fb2349',
  schoolSettingsCollectionId: 'school-settings',
  globalAdminTeamId: 'Proprietaire',
  schoolAdminTeams: {
    angers: '68eea3a20013ade40170',
    annecy: '68eea3f8001c4e2077b5',
    clermont: '68eea46a000cc0cab2c2',
    dijon: '68eea3cd0039a928f8f5',
    grenoble: '68eea460003bc49b999a',
    lille: '68eea40e000ff8b82ee0',
    lyon: '68eea4cc00243cc654f9',
    marseille: '68eea42200031f7c5111',
    montpellier: '68eea44000186df6d0f1',
    nancy: '68eea416001b46fd96e5',
    nantes: '68eea3e2002cdcf00a72',
    nice: '68eea42b003b154ff553',
    orleans: '68eea4020027c96816b8',
    paris: '68eea3c300135817b4f4',
    sorbonne: '68eea3b8002cdbab6088',
    tours: '68eea3d80007408a9d1c',
  },
};

export const appwriteOptions = {
  enableRealtime: true,
  allowAnonymousWrites: true,
};
