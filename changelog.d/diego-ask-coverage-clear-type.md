### Ask coverage: Clear type is excluded, the removed confirmWallGroup is gone

Main went red at #1026 because #1026 and #1027 were each green alone: #1027 added `clearWallGroupType` and removed `confirmWallGroup`, and #1026's exclusion list still named the old one and not the new. Clear type is excluded rather than registered: its argument is a group's runs on the sheet being looked at, so there is nothing a person can say to Ask that names it.
